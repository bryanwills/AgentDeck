#!/usr/bin/env python3
"""
Probe the ESP32-S3 USB-Serial/JTAG device with libusb as soon as it enumerates.

This does not try to flash the board. Its job is to answer two questions:
1. Can we open the device before macOS creates /dev/cu.usbmodem*?
2. Does any USB interface stay alive longer than the CDC port window?

Usage:
  python3 esp32/scripts/usb_hotplug_probe.py
  python3 esp32/scripts/usb_hotplug_probe.py --vid 0x303a --pid 0x1001 --hold 0 --hold 2
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import os
import signal
import sys
import time
from dataclasses import dataclass
from typing import Dict, List


LIBUSB_SUCCESS = 0
LIBUSB_HOTPLUG_EVENT_DEVICE_ARRIVED = 0x01
LIBUSB_HOTPLUG_EVENT_DEVICE_LEFT = 0x02
LIBUSB_HOTPLUG_MATCH_ANY = -1
LIBUSB_CAP_HAS_HOTPLUG = 1
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


class timeval(ctypes.Structure):
    _fields_ = [
        ("tv_sec", ctypes.c_long),
        ("tv_usec", ctypes.c_int),
    ]


@dataclass
class DeviceState:
    handle: ctypes.POINTER(libusb_device_handle)
    attached_at: float
    bus: int
    addr: int
    serial: str
    held_interfaces: List[int]


def monotonic_ms() -> int:
    return int(time.monotonic() * 1000)


class UsbProbe:
    def __init__(self, vid: int, pid: int, hold: List[int]) -> None:
        self.vid = vid
        self.pid = pid
        self.hold = hold
        self.lib = self._load_libusb()
        self.ctx = ctypes.POINTER(libusb_context)()
        self.devices: Dict[int, DeviceState] = {}
        self.seen: set[int] = set()
        self.callbacks = []
        self.running = True
        self.started_ms = monotonic_ms()
        self.disable_hotplug = os.environ.get("AGENTDECK_USB_NO_HOTPLUG") == "1"
        self._configure_ctypes()

    def _load_libusb(self):
        lib_path = ctypes.util.find_library("usb-1.0")
        if not lib_path:
            raise RuntimeError("libusb-1.0 not found")
        return ctypes.CDLL(lib_path)

    def _configure_ctypes(self) -> None:
        self.lib.libusb_init_context.argtypes = [
            ctypes.POINTER(ctypes.POINTER(libusb_context)),
            ctypes.c_void_p,
            ctypes.c_size_t,
        ]
        self.lib.libusb_init_context.restype = ctypes.c_int
        self.lib.libusb_exit.argtypes = [ctypes.POINTER(libusb_context)]
        self.lib.libusb_has_capability.argtypes = [ctypes.c_uint64]
        self.lib.libusb_has_capability.restype = ctypes.c_int
        self.lib.libusb_handle_events.argtypes = [ctypes.POINTER(libusb_context)]
        self.lib.libusb_handle_events.restype = ctypes.c_int
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
        self.lib.libusb_get_device_list.argtypes = [
            ctypes.POINTER(libusb_context),
            ctypes.POINTER(ctypes.POINTER(ctypes.POINTER(libusb_device))),
        ]
        self.lib.libusb_get_device_list.restype = ctypes.c_ssize_t
        self.lib.libusb_free_device_list.argtypes = [
            ctypes.POINTER(ctypes.POINTER(libusb_device)),
            ctypes.c_int,
        ]
        self.lib.libusb_get_bus_number.argtypes = [ctypes.POINTER(libusb_device)]
        self.lib.libusb_get_bus_number.restype = ctypes.c_uint8
        self.lib.libusb_get_device_address.argtypes = [ctypes.POINTER(libusb_device)]
        self.lib.libusb_get_device_address.restype = ctypes.c_uint8
        self.lib.libusb_get_string_descriptor_ascii.argtypes = [
            ctypes.POINTER(libusb_device_handle),
            ctypes.c_uint8,
            ctypes.POINTER(ctypes.c_ubyte),
            ctypes.c_int,
        ]
        self.lib.libusb_get_string_descriptor_ascii.restype = ctypes.c_int
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
        self.lib.libusb_handle_events_timeout_completed.argtypes = [
            ctypes.POINTER(libusb_context),
            ctypes.POINTER(timeval),
            ctypes.c_void_p,
        ]
        self.lib.libusb_handle_events_timeout_completed.restype = ctypes.c_int

        hotplug_cb = ctypes.CFUNCTYPE(
            ctypes.c_int,
            ctypes.POINTER(libusb_context),
            ctypes.POINTER(libusb_device),
            ctypes.c_int,
            ctypes.c_void_p,
        )
        self.hotplug_cb_type = hotplug_cb
        self.lib.libusb_hotplug_register_callback.argtypes = [
            ctypes.POINTER(libusb_context),
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            hotplug_cb,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_int),
        ]
        self.lib.libusb_hotplug_register_callback.restype = ctypes.c_int

    def _ms_since_start(self) -> int:
        return monotonic_ms() - self.started_ms

    def _string_desc(self, handle, idx: int) -> str:
        if not idx:
            return ""
        buf = (ctypes.c_ubyte * 256)()
        rc = self.lib.libusb_get_string_descriptor_ascii(handle, idx, buf, len(buf))
        if rc < 0:
            return ""
        return bytes(buf[:rc]).decode("utf-8", errors="replace")

    def _print_config(self, dev) -> None:
        cfg = ctypes.POINTER(libusb_config_descriptor)()
        rc = self.lib.libusb_get_config_descriptor(dev, 0, ctypes.byref(cfg))
        if rc != LIBUSB_SUCCESS:
            print(f"[{self._ms_since_start():>6} ms] get_config_descriptor failed rc={rc}")
            return
        try:
            desc = cfg.contents
            print(
                f"[{self._ms_since_start():>6} ms] config interfaces={desc.bNumInterfaces} "
                f"value={desc.bConfigurationValue}"
            )
            for i in range(desc.bNumInterfaces):
                iface = desc.interface[i]
                for alt in range(iface.num_altsetting):
                    idesc = iface.altsetting[alt]
                    print(
                        f"  iface={idesc.bInterfaceNumber} alt={idesc.bAlternateSetting} "
                        f"class=0x{idesc.bInterfaceClass:02x} "
                        f"sub=0x{idesc.bInterfaceSubClass:02x} "
                        f"proto=0x{idesc.bInterfaceProtocol:02x} "
                        f"eps={idesc.bNumEndpoints}"
                    )
                    for e in range(idesc.bNumEndpoints):
                        ep = idesc.endpoint[e]
                        direction = "IN" if ep.bEndpointAddress & LIBUSB_ENDPOINT_IN else "OUT"
                        transfer = ep.bmAttributes & LIBUSB_TRANSFER_TYPE_MASK
                        print(
                            f"    ep=0x{ep.bEndpointAddress:02x} dir={direction} "
                            f"type={transfer} maxpkt={ep.wMaxPacketSize}"
                        )
        finally:
            self.lib.libusb_free_config_descriptor(cfg)

    def _claim_interfaces(self, handle) -> List[int]:
        held = []
        for iface in self.hold:
            rc = self.lib.libusb_claim_interface(handle, iface)
            if rc == LIBUSB_SUCCESS:
                print(f"[{self._ms_since_start():>6} ms] claim iface={iface} OK")
                held.append(iface)
            else:
                print(f"[{self._ms_since_start():>6} ms] claim iface={iface} rc={rc}")
        return held

    def _matches_target(self, dd: libusb_device_descriptor) -> bool:
        return dd.idVendor == self.vid and dd.idProduct == self.pid

    def _on_arrived(self, dev, source: str = "hotplug") -> int:
        dd = libusb_device_descriptor()
        rc = self.lib.libusb_get_device_descriptor(dev, ctypes.byref(dd))
        if rc != LIBUSB_SUCCESS:
            print(f"[{self._ms_since_start():>6} ms] descriptor read failed rc={rc}")
            return 0
        if not self._matches_target(dd):
            return 0

        bus = int(self.lib.libusb_get_bus_number(dev))
        addr = int(self.lib.libusb_get_device_address(dev))
        print(
            f"[{self._ms_since_start():>6} ms] ARRIVED({source}) vid=0x{dd.idVendor:04x} "
            f"pid=0x{dd.idProduct:04x} bus={bus} addr={addr}"
        )

        handle = ctypes.POINTER(libusb_device_handle)()
        rc = self.lib.libusb_open(dev, ctypes.byref(handle))
        if rc != LIBUSB_SUCCESS:
            print(f"[{self._ms_since_start():>6} ms] open failed rc={rc}")
            return 0

        serial = self._string_desc(handle, dd.iSerialNumber)
        manufacturer = self._string_desc(handle, dd.iManufacturer)
        product = self._string_desc(handle, dd.iProduct)
        print(
            f"[{self._ms_since_start():>6} ms] OPENED mfg={manufacturer!r} "
            f"product={product!r} serial={serial!r}"
        )

        self._print_config(dev)
        held = self._claim_interfaces(handle)
        key = ctypes.addressof(dev.contents)
        self.devices[key] = DeviceState(
            handle=handle,
            attached_at=time.monotonic(),
            bus=bus,
            addr=addr,
            serial=serial,
            held_interfaces=held,
        )
        return 0

    def _on_left(self, dev, source: str = "hotplug") -> int:
        key = ctypes.addressof(dev.contents)
        state = self.devices.pop(key, None)
        self.seen.discard(key)
        print(f"[{self._ms_since_start():>6} ms] LEFT({source})")
        if state:
            lived_ms = int((time.monotonic() - state.attached_at) * 1000)
            print(
                f"[{self._ms_since_start():>6} ms] held for {lived_ms} ms "
                f"bus={state.bus} addr={state.addr} serial={state.serial!r}"
            )
            for iface in state.held_interfaces:
                self.lib.libusb_release_interface(state.handle, iface)
            self.lib.libusb_close(state.handle)
        return 0

    def _callback(self, _ctx, dev, event, _user_data) -> int:
        if event == LIBUSB_HOTPLUG_EVENT_DEVICE_ARRIVED:
            return self._on_arrived(dev, "hotplug")
        if event == LIBUSB_HOTPLUG_EVENT_DEVICE_LEFT:
            return self._on_left(dev, "hotplug")
        return 0

    def _poll_devices(self) -> None:
        devs = ctypes.POINTER(ctypes.POINTER(libusb_device))()
        count = self.lib.libusb_get_device_list(self.ctx, ctypes.byref(devs))
        if count < 0:
            print(f"[{self._ms_since_start():>6} ms] get_device_list rc={count}")
            return
        current: set[int] = set()
        try:
            for i in range(count):
                dev = devs[i]
                if not dev:
                    continue
                dd = libusb_device_descriptor()
                rc = self.lib.libusb_get_device_descriptor(dev, ctypes.byref(dd))
                if rc != LIBUSB_SUCCESS or not self._matches_target(dd):
                    continue
                key = ctypes.addressof(dev.contents)
                current.add(key)
                if key not in self.seen:
                    self.seen.add(key)
                    self._on_arrived(dev, "poll")
            for key in list(self.seen - current):
                state = self.devices.pop(key, None)
                self.seen.discard(key)
                print(f"[{self._ms_since_start():>6} ms] LEFT(poll)")
                if state:
                    lived_ms = int((time.monotonic() - state.attached_at) * 1000)
                    print(
                        f"[{self._ms_since_start():>6} ms] held for {lived_ms} ms "
                        f"bus={state.bus} addr={state.addr} serial={state.serial!r}"
                    )
                    for iface in state.held_interfaces:
                        self.lib.libusb_release_interface(state.handle, iface)
                    self.lib.libusb_close(state.handle)
        finally:
            self.lib.libusb_free_device_list(devs, 1)

    def run(self) -> int:
        rc = self.lib.libusb_init_context(ctypes.byref(self.ctx), None, 0)
        if rc != LIBUSB_SUCCESS:
            print(f"libusb init failed rc={rc}", file=sys.stderr)
            return 1
        if not self.lib.libusb_has_capability(LIBUSB_CAP_HAS_HOTPLUG):
            print("libusb hotplug not supported on this system", file=sys.stderr)
            return 1

        if not self.disable_hotplug:
            callback = self.hotplug_cb_type(self._callback)
            self.callbacks.append(callback)
            handle = ctypes.c_int()
            rc = self.lib.libusb_hotplug_register_callback(
                self.ctx,
                LIBUSB_HOTPLUG_EVENT_DEVICE_ARRIVED | LIBUSB_HOTPLUG_EVENT_DEVICE_LEFT,
                0,
                self.vid,
                self.pid,
                LIBUSB_HOTPLUG_MATCH_ANY,
                callback,
                None,
                ctypes.byref(handle),
            )
            if rc != LIBUSB_SUCCESS:
                print(f"hotplug callback registration failed rc={rc}", file=sys.stderr)
                return 1

        print(
            f"Watching for USB device vid=0x{self.vid:04x} pid=0x{self.pid:04x}; "
            f"hold interfaces={self.hold} poll=10ms hotplug={'off' if self.disable_hotplug else 'on'}"
        )
        while self.running:
            self._poll_devices()
            timeout = timeval(0, 10_000)
            rc = self.lib.libusb_handle_events_timeout_completed(
                self.ctx, ctypes.byref(timeout), None
            )
            if rc != LIBUSB_SUCCESS and self.running:
                print(f"libusb_handle_events_timeout_completed rc={rc}", file=sys.stderr)
                return 1
        return 0

    def stop(self, *_args) -> None:
        self.running = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vid", type=lambda x: int(x, 0), default=0x303A)
    parser.add_argument("--pid", type=lambda x: int(x, 0), default=0x1001)
    parser.add_argument(
        "--hold",
        type=int,
        action="append",
        default=[0, 1, 2],
        help="Interface number(s) to claim immediately on attach.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    probe = UsbProbe(args.vid, args.pid, args.hold)
    signal.signal(signal.SIGINT, probe.stop)
    signal.signal(signal.SIGTERM, probe.stop)
    return probe.run()


if __name__ == "__main__":
    raise SystemExit(main())
