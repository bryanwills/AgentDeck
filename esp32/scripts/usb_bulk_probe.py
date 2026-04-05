#!/usr/bin/env python3
"""
Endpoint-level probe for the ESP32-S3 USB Serial/JTAG device.

Purpose:
- claim CDC data (iface 1) and JTAG vendor (iface 2) immediately on attach
- measure how long bulk endpoints remain usable
- optionally perform small writes to test whether the OUT endpoints accept traffic

Default mode is read-only except for interface claiming.
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import signal
import sys
import time
from dataclasses import dataclass, field
from typing import Dict, List


LIBUSB_SUCCESS = 0
LIBUSB_ERROR_TIMEOUT = -7
LIBUSB_ENDPOINT_IN = 0x80
LIBUSB_TRANSFER_TYPE_MASK = 0x03


class libusb_context(ctypes.Structure):
    pass


class libusb_device(ctypes.Structure):
    pass


class libusb_device_handle(ctypes.Structure):
    pass


class libusb_endpoint_descriptor(ctypes.Structure):
    _fields_ = [
        ("bLength", ctypes.c_uint8),
        ("bDescriptorType", ctypes.c_uint8),
        ("bEndpointAddress", ctypes.c_uint8),
        ("bmAttributes", ctypes.c_uint8),
        ("wMaxPacketSize", ctypes.c_uint16),
        ("bInterval", ctypes.c_uint8),
        ("bRefresh", ctypes.c_uint8),
        ("bSynchAddress", ctypes.c_uint8),
        ("extra", ctypes.POINTER(ctypes.c_uint8)),
        ("extra_length", ctypes.c_int),
    ]


class libusb_interface_descriptor(ctypes.Structure):
    _fields_ = [
        ("bLength", ctypes.c_uint8),
        ("bDescriptorType", ctypes.c_uint8),
        ("bInterfaceNumber", ctypes.c_uint8),
        ("bAlternateSetting", ctypes.c_uint8),
        ("bNumEndpoints", ctypes.c_uint8),
        ("bInterfaceClass", ctypes.c_uint8),
        ("bInterfaceSubClass", ctypes.c_uint8),
        ("bInterfaceProtocol", ctypes.c_uint8),
        ("iInterface", ctypes.c_uint8),
        ("endpoint", ctypes.POINTER(libusb_endpoint_descriptor)),
        ("extra", ctypes.POINTER(ctypes.c_uint8)),
        ("extra_length", ctypes.c_int),
    ]


class libusb_interface(ctypes.Structure):
    _fields_ = [
        ("altsetting", ctypes.POINTER(libusb_interface_descriptor)),
        ("num_altsetting", ctypes.c_int),
    ]


class libusb_config_descriptor(ctypes.Structure):
    _fields_ = [
        ("bLength", ctypes.c_uint8),
        ("bDescriptorType", ctypes.c_uint8),
        ("wTotalLength", ctypes.c_uint16),
        ("bNumInterfaces", ctypes.c_uint8),
        ("bConfigurationValue", ctypes.c_uint8),
        ("iConfiguration", ctypes.c_uint8),
        ("bmAttributes", ctypes.c_uint8),
        ("MaxPower", ctypes.c_uint8),
        ("interface", ctypes.POINTER(libusb_interface)),
        ("extra", ctypes.POINTER(ctypes.c_uint8)),
        ("extra_length", ctypes.c_int),
    ]


class libusb_device_descriptor(ctypes.Structure):
    _fields_ = [
        ("bLength", ctypes.c_uint8),
        ("bDescriptorType", ctypes.c_uint8),
        ("bcdUSB", ctypes.c_uint16),
        ("bDeviceClass", ctypes.c_uint8),
        ("bDeviceSubClass", ctypes.c_uint8),
        ("bDeviceProtocol", ctypes.c_uint8),
        ("bMaxPacketSize0", ctypes.c_uint8),
        ("idVendor", ctypes.c_uint16),
        ("idProduct", ctypes.c_uint16),
        ("bcdDevice", ctypes.c_uint16),
        ("iManufacturer", ctypes.c_uint8),
        ("iProduct", ctypes.c_uint8),
        ("iSerialNumber", ctypes.c_uint8),
        ("bNumConfigurations", ctypes.c_uint8),
    ]


@dataclass
class EndpointInfo:
    iface: int
    ep: int
    direction_in: bool
    max_packet: int
    last_ok_at: float | None = None
    last_rc: int | None = None
    ok_count: int = 0
    bytes_seen: int = 0


@dataclass
class DeviceSession:
    handle: ctypes.POINTER(libusb_device_handle)
    key: int
    serial: str
    attached_at: float
    endpoints: List[EndpointInfo] = field(default_factory=list)


def monotonic_ms() -> int:
    return int(time.monotonic() * 1000)


class BulkProbe:
    def __init__(
        self,
        vid: int,
        pid: int,
        do_write: bool,
        timeout_ms: int,
        iface_filter: List[int],
        jtag_first: bool,
    ) -> None:
        self.vid = vid
        self.pid = pid
        self.do_write = do_write
        self.timeout_ms = timeout_ms
        self.iface_filter = set(iface_filter)
        self.jtag_first = jtag_first
        self.lib = ctypes.CDLL(ctypes.util.find_library("usb-1.0"))
        self.ctx = ctypes.POINTER(libusb_context)()
        self.running = True
        self.started_ms = monotonic_ms()
        self.sessions: Dict[int, DeviceSession] = {}
        self._configure_ctypes()

    def _configure_ctypes(self) -> None:
        self.lib.libusb_init_context.argtypes = [
            ctypes.POINTER(ctypes.POINTER(libusb_context)),
            ctypes.c_void_p,
            ctypes.c_size_t,
        ]
        self.lib.libusb_init_context.restype = ctypes.c_int
        self.lib.libusb_exit.argtypes = [ctypes.POINTER(libusb_context)]
        self.lib.libusb_get_device_list.argtypes = [
            ctypes.POINTER(libusb_context),
            ctypes.POINTER(ctypes.POINTER(ctypes.POINTER(libusb_device))),
        ]
        self.lib.libusb_get_device_list.restype = ctypes.c_ssize_t
        self.lib.libusb_free_device_list.argtypes = [
            ctypes.POINTER(ctypes.POINTER(libusb_device)),
            ctypes.c_int,
        ]
        self.lib.libusb_get_device_descriptor.argtypes = [
            ctypes.POINTER(libusb_device),
            ctypes.POINTER(libusb_device_descriptor),
        ]
        self.lib.libusb_get_device_descriptor.restype = ctypes.c_int
        self.lib.libusb_get_config_descriptor.argtypes = [
            ctypes.POINTER(libusb_device),
            ctypes.c_uint8,
            ctypes.POINTER(ctypes.POINTER(libusb_config_descriptor)),
        ]
        self.lib.libusb_get_config_descriptor.restype = ctypes.c_int
        self.lib.libusb_free_config_descriptor.argtypes = [
            ctypes.POINTER(libusb_config_descriptor)
        ]
        self.lib.libusb_open.argtypes = [
            ctypes.POINTER(libusb_device),
            ctypes.POINTER(ctypes.POINTER(libusb_device_handle)),
        ]
        self.lib.libusb_open.restype = ctypes.c_int
        self.lib.libusb_close.argtypes = [ctypes.POINTER(libusb_device_handle)]
        self.lib.libusb_claim_interface.argtypes = [
            ctypes.POINTER(libusb_device_handle),
            ctypes.c_int,
        ]
        self.lib.libusb_claim_interface.restype = ctypes.c_int
        self.lib.libusb_release_interface.argtypes = [
            ctypes.POINTER(libusb_device_handle),
            ctypes.c_int,
        ]
        self.lib.libusb_release_interface.restype = ctypes.c_int
        self.lib.libusb_bulk_transfer.argtypes = [
            ctypes.POINTER(libusb_device_handle),
            ctypes.c_ubyte,
            ctypes.POINTER(ctypes.c_ubyte),
            ctypes.c_int,
            ctypes.POINTER(ctypes.c_int),
            ctypes.c_uint,
        ]
        self.lib.libusb_bulk_transfer.restype = ctypes.c_int
        self.lib.libusb_get_string_descriptor_ascii.argtypes = [
            ctypes.POINTER(libusb_device_handle),
            ctypes.c_uint8,
            ctypes.POINTER(ctypes.c_ubyte),
            ctypes.c_int,
        ]
        self.lib.libusb_get_string_descriptor_ascii.restype = ctypes.c_int

    def _ms(self) -> int:
        return monotonic_ms() - self.started_ms

    def _str_desc(self, handle, idx: int) -> str:
        if not idx:
            return ""
        buf = (ctypes.c_ubyte * 256)()
        rc = self.lib.libusb_get_string_descriptor_ascii(handle, idx, buf, len(buf))
        if rc < 0:
            return ""
        return bytes(buf[:rc]).decode("utf-8", errors="replace").rstrip("\x00")

    def _cleanup_session(self, session: DeviceSession, reason: str) -> None:
        lived_ms = int((time.monotonic() - session.attached_at) * 1000)
        print(f"[{self._ms():>6} ms] detach({reason}) serial={session.serial!r} lived={lived_ms}ms")
        seen_ifaces = set()
        for ep in session.endpoints:
            age = -1
            if ep.last_ok_at is not None:
                age = int((ep.last_ok_at - session.attached_at) * 1000)
            direction = "IN" if ep.direction_in else "OUT"
            print(
                f"  iface={ep.iface} ep=0x{ep.ep:02x} {direction} ok={ep.ok_count} "
                f"bytes={ep.bytes_seen} last_rc={ep.last_rc} last_ok_at={age}ms"
            )
            seen_ifaces.add(ep.iface)
        for iface in sorted(seen_ifaces):
            self.lib.libusb_release_interface(session.handle, iface)
        self.lib.libusb_close(session.handle)

    def _attach(self, dev) -> None:
        dd = libusb_device_descriptor()
        if self.lib.libusb_get_device_descriptor(dev, ctypes.byref(dd)) != LIBUSB_SUCCESS:
            return
        if dd.idVendor != self.vid or dd.idProduct != self.pid:
            return
        key = ctypes.addressof(dev.contents)
        if key in self.sessions:
            return

        handle = ctypes.POINTER(libusb_device_handle)()
        rc = self.lib.libusb_open(dev, ctypes.byref(handle))
        if rc != LIBUSB_SUCCESS:
            print(f"[{self._ms():>6} ms] open rc={rc}")
            return

        serial = self._str_desc(handle, dd.iSerialNumber)
        print(f"[{self._ms():>6} ms] attach serial={serial!r}")

        cfg = ctypes.POINTER(libusb_config_descriptor)()
        rc = self.lib.libusb_get_config_descriptor(dev, 0, ctypes.byref(cfg))
        if rc != LIBUSB_SUCCESS:
            print(f"[{self._ms():>6} ms] get_config_descriptor rc={rc}")
            self.lib.libusb_close(handle)
            return

        endpoints: List[EndpointInfo] = []
        try:
            desc = cfg.contents
            for i in range(desc.bNumInterfaces):
                iface = desc.interface[i]
                for alt in range(iface.num_altsetting):
                    idesc = iface.altsetting[alt]
                    iface_num = int(idesc.bInterfaceNumber)
                    if iface_num not in self.iface_filter:
                        continue
                    rc = self.lib.libusb_claim_interface(handle, iface_num)
                    print(f"[{self._ms():>6} ms] claim iface={iface_num} rc={rc}")
                    if rc != LIBUSB_SUCCESS:
                        continue
                    for e in range(idesc.bNumEndpoints):
                        ep = idesc.endpoint[e]
                        if (ep.bmAttributes & LIBUSB_TRANSFER_TYPE_MASK) != 2:
                            continue
                        endpoints.append(
                            EndpointInfo(
                                iface=iface_num,
                                ep=int(ep.bEndpointAddress),
                                direction_in=bool(ep.bEndpointAddress & LIBUSB_ENDPOINT_IN),
                                max_packet=int(ep.wMaxPacketSize),
                            )
                        )
        finally:
            self.lib.libusb_free_config_descriptor(cfg)

        if not endpoints:
            self.lib.libusb_close(handle)
            return

        self.sessions[key] = DeviceSession(
            handle=handle,
            key=key,
            serial=serial,
            attached_at=time.monotonic(),
            endpoints=endpoints,
        )
        if self.jtag_first:
            self.sessions[key].endpoints.sort(key=lambda ep: (ep.iface != 2, ep.direction_in is False, ep.ep))
        for ep in endpoints:
            direction = "IN" if ep.direction_in else "OUT"
            print(
                f"[{self._ms():>6} ms] endpoint iface={ep.iface} ep=0x{ep.ep:02x} "
                f"{direction} maxpkt={ep.max_packet}"
            )

    def _scan(self) -> None:
        devs = ctypes.POINTER(ctypes.POINTER(libusb_device))()
        count = self.lib.libusb_get_device_list(self.ctx, ctypes.byref(devs))
        if count < 0:
            print(f"[{self._ms():>6} ms] get_device_list rc={count}")
            return
        current = set()
        try:
            for i in range(count):
                dev = devs[i]
                if not dev:
                    continue
                dd = libusb_device_descriptor()
                rc = self.lib.libusb_get_device_descriptor(dev, ctypes.byref(dd))
                if rc != LIBUSB_SUCCESS:
                    continue
                if dd.idVendor != self.vid or dd.idProduct != self.pid:
                    continue
                key = ctypes.addressof(dev.contents)
                current.add(key)
                self._attach(dev)
        finally:
            self.lib.libusb_free_device_list(devs, 1)

        for key in list(self.sessions.keys()):
            if key not in current:
                session = self.sessions.pop(key)
                self._cleanup_session(session, "gone")

    def _probe_session(self, session: DeviceSession) -> bool:
        for ep in session.endpoints:
            transferred = ctypes.c_int(0)
            if ep.direction_in:
                buf = (ctypes.c_ubyte * 64)()
                rc = self.lib.libusb_bulk_transfer(
                    session.handle,
                    ep.ep,
                    buf,
                    len(buf),
                    ctypes.byref(transferred),
                    self.timeout_ms,
                )
                ep.last_rc = rc
                if rc == LIBUSB_SUCCESS:
                    ep.ok_count += 1
                    ep.bytes_seen += transferred.value
                    ep.last_ok_at = time.monotonic()
                    if transferred.value:
                        data = bytes(buf[: transferred.value]).hex(" ")
                        print(
                            f"[{self._ms():>6} ms] read iface={ep.iface} ep=0x{ep.ep:02x} "
                            f"len={transferred.value} data={data}"
                        )
                elif rc != LIBUSB_ERROR_TIMEOUT:
                    print(f"[{self._ms():>6} ms] read iface={ep.iface} ep=0x{ep.ep:02x} rc={rc}")
                    return False
            elif self.do_write:
                payload = b"\x00"
                buf = (ctypes.c_ubyte * len(payload))(*payload)
                rc = self.lib.libusb_bulk_transfer(
                    session.handle,
                    ep.ep,
                    buf,
                    len(payload),
                    ctypes.byref(transferred),
                    self.timeout_ms,
                )
                ep.last_rc = rc
                if rc == LIBUSB_SUCCESS:
                    ep.ok_count += 1
                    ep.bytes_seen += transferred.value
                    ep.last_ok_at = time.monotonic()
                    print(
                        f"[{self._ms():>6} ms] write iface={ep.iface} ep=0x{ep.ep:02x} "
                        f"len={transferred.value}"
                    )
                elif rc != LIBUSB_ERROR_TIMEOUT:
                    print(f"[{self._ms():>6} ms] write iface={ep.iface} ep=0x{ep.ep:02x} rc={rc}")
                    return False
        return True

    def run(self) -> int:
        rc = self.lib.libusb_init_context(ctypes.byref(self.ctx), None, 0)
        if rc != LIBUSB_SUCCESS:
            print(f"libusb init failed rc={rc}", file=sys.stderr)
            return 1
        print(
            f"Watching bulk endpoints for vid=0x{self.vid:04x} pid=0x{self.pid:04x} "
            f"write={'on' if self.do_write else 'off'} timeout={self.timeout_ms}ms"
        )
        while self.running:
            self._scan()
            for key in list(self.sessions.keys()):
                session = self.sessions.get(key)
                if session and not self._probe_session(session):
                    session = self.sessions.pop(key)
                    self._cleanup_session(session, "bulk-fail")
            time.sleep(0.005)
        for key in list(self.sessions.keys()):
            session = self.sessions.pop(key)
            self._cleanup_session(session, "stop")
        self.lib.libusb_exit(self.ctx)
        return 0

    def stop(self, *_args) -> None:
        self.running = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vid", type=lambda x: int(x, 0), default=0x303A)
    parser.add_argument("--pid", type=lambda x: int(x, 0), default=0x1001)
    parser.add_argument("--write", action="store_true", help="Send 1-byte writes to OUT endpoints.")
    parser.add_argument("--timeout-ms", type=int, default=8)
    parser.add_argument(
        "--iface",
        type=int,
        action="append",
        choices=[1, 2],
        help="Probe only selected interface(s). Default: both 1 and 2.",
    )
    parser.add_argument(
        "--jtag-first",
        action="store_true",
        help="Probe interface 2 endpoints before CDC endpoints.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    probe = BulkProbe(
        args.vid,
        args.pid,
        args.write,
        args.timeout_ms,
        args.iface or [1, 2],
        args.jtag_first,
    )
    signal.signal(signal.SIGINT, probe.stop)
    signal.signal(signal.SIGTERM, probe.stop)
    return probe.run()


if __name__ == "__main__":
    raise SystemExit(main())
