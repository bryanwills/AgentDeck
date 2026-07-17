#if os(macOS)
// MicroGlyphs.swift — Native 11×11 creature glyphs for the Timebox Mini micro layout.
//
// Swift mirror of bridge/src/pixoo/micro-glyphs.ts (the SSOT). The Timebox Mini has
// only 121 LEDs; downscaling the 32×32 terrarium creature bottoms out at a fuzzy
// silhouette, so each creature is authored directly at 11×11 as a bold, high-contrast
// bitmap. The glyphs are reviewed pixel reductions of design/brand/*.svg:
// Claude=rusty robot, Codex=cloud+`>_`, OpenClaw=lobster,
// OpenCode=ring, Antigravity=peak/arc.
//
// The grid/color DATA lives in MicroGlyphs.generated.swift, produced from the TS
// module by `pnpm generate-micro-glyphs` — do NOT hand-edit the data here or there;
// edit micro-glyphs.ts and regenerate so the App Store macOS build and the Node CLI
// can never drift. This file holds only the consuming logic (paint + statusBg).
//
// Grid characters: '.' transparent (shows status bg), 'B' body, 'A' arm/leg/antenna,
// 'C' claw, 'D' joint/shadow, 'E' eye, 'K' cutout, 'M' prompt marking, 'F' logo frame.
// Antigravity also uses L/T/Q/Y/O/R/P/V/U/N gradient bands and K black cutout.

import Foundation

enum MicroCreature { case octopus, codex, opencode, crayfish, antigravity }
enum MicroGlyphState { case idle, working, asking }
enum MicroAggregate { case idle, processing, awaiting, error }

enum MicroGlyphs {
    typealias RGB = (UInt8, UInt8, UInt8)
    static let size = 11

    // Constructed by the generated data table (MicroGlyphs.generated.swift), keyed by
    // the TS MicroCreature names. Kept non-private so the generated extension can build it.
    struct Glyph {
        let colors: [Character: RGB]
        let idle: [String]
        let work: [String]?
    }

    private static func glyph(for creature: MicroCreature) -> Glyph {
        // Maps the Swift enum to the TS creature key (jellyfish == codex).
        switch creature {
        case .octopus: return generatedGlyphs["octopus"]!
        case .codex: return generatedGlyphs["jellyfish"]!
        case .opencode: return generatedGlyphs["opencode"]!
        case .crayfish: return generatedGlyphs["crayfish"]!
        case .antigravity: return generatedGlyphs["antigravity"]!
        }
    }

    /// Dark status-color field so the bright creature pops. Idle is steady; both
    /// active states breathe so the panel visibly "works" (parity with the TS
    /// `microStatusBg`): processing = slow blue heartbeat, awaiting = faster amber.
    static func statusBg(_ state: MicroAggregate, animFrame: Int) -> RGB {
        switch state {
        case .error: return (64, 18, 18)
        case .awaiting:
            let p = 0.78 + 0.22 * ((sin(Double(animFrame) * 0.25) + 1) / 2)
            return (UInt8(74 * p), UInt8(50 * p), UInt8(10 * p))
        case .processing:
            let p = 0.68 + 0.32 * ((sin(Double(animFrame) * 0.18) + 1) / 2)
            return (UInt8(16 * p), UInt8(40 * p), UInt8(88 * p))
        case .idle: return (16, 56, 28)
        }
    }

    /// Paint a creature glyph onto an 11×11 RGB buffer (only non-transparent pixels).
    /// `working` alternates two leg frames; `asking` reuses the idle pose.
    static func paint(_ buf: inout [UInt8], creature: MicroCreature, state: MicroGlyphState, animFrame: Int) {
        let g = glyph(for: creature)
        let grid: [String]
        if state == .working, let work = g.work, ((animFrame >> 2) & 1) == 1 {
            grid = work
        } else {
            grid = g.idle
        }
        let drift = creature == .antigravity ? (animFrame / 6) % 4 : 0
        let offsetX = creature == .antigravity && state == .working
            ? (drift == 1 ? 1 : (drift == 3 ? -1 : 0))
            : 0
        let offsetY = creature == .antigravity && state != .idle && (drift == 0 || drift == 1) ? -1 : 0
        for y in 0..<size {
            let row = Array(grid[y])
            for x in 0..<size {
                guard let col = g.colors[row[x]] else { continue }
                let dx = x + offsetX
                let dy = y + offsetY
                guard dx >= 0, dx < size, dy >= 0, dy < size else { continue }
                let i = (dy * size + dx) * 3
                buf[i] = col.0; buf[i + 1] = col.1; buf[i + 2] = col.2
            }
        }
    }
}
#endif
