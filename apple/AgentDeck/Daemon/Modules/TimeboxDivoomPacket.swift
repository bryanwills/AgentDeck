#if os(macOS)
// TimeboxDivoomPacket.swift — Divoom Timebox Mini static-image protocol encoder.
//
// Ports bridge/src/timebox/sync.py's packet construction to Swift so the App Store
// macOS build can drive a BLE Timebox Mini with NO subprocess (App Review 2.5.2).
// This has NO iDotMatrix analog — iDotMatrix sends PNG-chunked frames, whereas the
// Timebox speaks a 4-bit-per-channel nibble image inside a `0x44` static-image
// command, checksummed and wrapped in an escaped 0x01…0x02 frame.
//
// Byte-for-byte parity with sync.py is verified by TimeboxProtocolTests against
// golden vectors generated from the Python source. If these drift, the panel shows
// garbage or nothing.

import Foundation

enum TimeboxDivoomPacket {
    static let width = 11
    static let height = 11
    /// `0x00BD` (189) — fixed total length of the static-image command.
    static let staticImageCmdLen = 0x00BD

    static func clampNibble(_ value: Int) -> Int { max(0, min(15, value)) }

    /// Pack a final 11×11 RGB buffer (363 bytes) into the 182-byte Timebox payload:
    /// each channel quantized to 4 bits via `round(c/17)`, two nibbles per byte
    /// (`low | high<<4`). Mirrors sync.py `encode_image_bytes`'s nibble loop.
    /// `round(c/17)` never hits an exact .5 for integer c, so Swift's
    /// round-half-away matches Python's round-half-even here.
    static func nibblePack(rgb: [UInt8]) -> [UInt8] {
        precondition(rgb.count == width * height * 3, "Timebox image must be 11×11 RGB")
        var nibbles: [Int] = []
        nibbles.reserveCapacity(width * height * 3)
        for i in 0..<(width * height) {
            let r = Int(rgb[i * 3]), g = Int(rgb[i * 3 + 1]), b = Int(rgb[i * 3 + 2])
            nibbles.append(clampNibble(Int((Double(r) / 17.0).rounded())))
            nibbles.append(clampNibble(Int((Double(g) / 17.0).rounded())))
            nibbles.append(clampNibble(Int((Double(b) / 17.0).rounded())))
        }
        var out: [UInt8] = []
        out.reserveCapacity((nibbles.count + 1) / 2)
        var idx = 0
        while idx < nibbles.count {
            let low = nibbles[idx]
            let high = idx + 1 < nibbles.count ? nibbles[idx + 1] : 0
            out.append(UInt8(low | (high << 4)))
            idx += 2
        }
        return out
    }

    /// Wrap a byte stream in the Timebox 0x01…0x02 frame, escaping any
    /// 0x01/0x02/0x03 as `0x03, b+0x03`. Mirrors sync.py `escape_message`.
    static func escape(_ data: [UInt8]) -> [UInt8] {
        var out: [UInt8] = [0x01]
        for b in data {
            if b == 0x01 || b == 0x02 || b == 0x03 {
                out.append(0x03)
                out.append(b &+ 0x03)
            } else {
                out.append(b)
            }
        }
        out.append(0x02)
        return out
    }

    /// Build the full escaped static-image packet from a 182-byte payload.
    /// Mirrors sync.py `build_static_image_packet`.
    static func buildStaticImagePacket(payload: [UInt8]) -> [UInt8] {
        var cmd: [UInt8] = [
            UInt8(staticImageCmdLen & 0xFF),
            UInt8((staticImageCmdLen >> 8) & 0xFF),
            0x44, 0x00, 0x0A, 0x0A, 0x04,
        ]
        cmd.append(contentsOf: payload)
        precondition(cmd.count == staticImageCmdLen, "Timebox command length mismatch")
        let checksum = cmd.reduce(0) { $0 + Int($1) } & 0xFFFF
        var framed = cmd
        framed.append(UInt8(checksum & 0xFF))
        framed.append(UInt8((checksum >> 8) & 0xFF))
        return escape(framed)
    }

    /// Convenience: 11×11 RGB → full escaped packet ready for BLE.
    static func packet(fromRGB rgb: [UInt8]) -> [UInt8] {
        buildStaticImagePacket(payload: nibblePack(rgb: rgb))
    }
}
#endif
