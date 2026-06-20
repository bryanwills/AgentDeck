#if os(macOS)
// MicroGlyphs.swift — Native 11×11 creature glyphs for the Timebox Mini micro layout.
//
// Swift mirror of bridge/src/pixoo/micro-glyphs.ts. The Timebox Mini has only 121
// LEDs; downscaling the 32×32 terrarium creature bottoms out at a fuzzy silhouette,
// so each creature is hand-authored directly at 11×11 as a bold, high-contrast
// bitmap. The glyph grids and brand colors here are kept byte-identical to the TS
// module so the App Store macOS build and the Node CLI render the same frames.
//
// Grid characters: '.' transparent (shows status bg), 'B' body, 'A' arm/leg/antenna,
// 'C' claw, 'E' eye, 'M' prompt marking, 'F' logo frame.

import Foundation

enum MicroCreature { case octopus, codex, opencode, crayfish }
enum MicroGlyphState { case idle, working, asking }
enum MicroAggregate { case idle, processing, awaiting, error }

enum MicroGlyphs {
    typealias RGB = (UInt8, UInt8, UInt8)
    static let size = 11

    private struct Glyph {
        let colors: [Character: RGB]
        let idle: [String]
        let work: [String]?
    }

    // Claude Code — terracotta octopus (#C07058): body, two eyes, side arms, legs.
    private static let octopus = Glyph(
        colors: ["B": (235, 130, 90), "A": (200, 100, 72), "E": (16, 9, 9)],
        idle: [
            "...........",
            "..BBBBBBB..",
            ".BBBBBBBBB.",
            ".BBBBBBBBB.",
            ".BBEBBBEBB.",
            "ABBBBBBBBBA",
            "ABBBBBBBBBA",
            ".BBBBBBBBB.",
            ".A.A.A.A.A.",
            ".A.A.A.A.A.",
            "...........",
        ],
        work: [
            "...........",
            "..BBBBBBB..",
            ".BBBBBBBBB.",
            ".BBBBBBBBB.",
            ".BBEBBBEBB.",
            "ABBBBBBBBBA",
            "ABBBBBBBBBA",
            ".BBBBBBBBB.",
            "A.A.A.A.A.A",
            ".A.A.A.A.A.",
            "...........",
        ]
    )

    // Codex — indigo cloud (#6166E0) with a white `>` chevron + `_` terminal prompt.
    private static let codex = Glyph(
        colors: ["B": (120, 126, 236), "M": (238, 240, 255)],
        idle: [
            "...........",
            "...BBBBB...",
            "..BBBBBBB..",
            ".BBBBBBBBB.",
            ".BMBBBBBBB.",
            ".BBMBBBBBB.",
            ".BMBBMMMBB.",
            ".BBBBBBBBB.",
            "..BBBBBBB..",
            "...BBBBB...",
            "...........",
        ],
        work: nil
    )

    // OpenCode — nested square bracket + core block (the OpenCode logo).
    private static let opencode = Glyph(
        colors: ["F": (232, 232, 232), "C": (120, 124, 150)],
        idle: [
            "...........",
            ".FFFFFF....",
            ".FF...F....",
            ".FF........",
            ".FF...CCCC.",
            ".FF.F.CCCC.",
            ".FFFF.CCCC.",
            "......CCCC.",
            "......CCCC.",
            "...........",
            "...........",
        ],
        work: nil
    )

    // OpenClaw — red crayfish (#FF4D4D): round body, antennae to corners, claws, legs, eyes.
    private static let crayfish = Glyph(
        colors: ["B": (255, 92, 92), "C": (225, 70, 70), "A": (220, 120, 110), "E": (16, 9, 9)],
        idle: [
            "A.........A",
            ".A.......A.",
            "...BBBBB...",
            "..CBBBBBC..",
            "..BBEBEBB..",
            ".CBBBBBBBC.",
            "..BBBBBBB..",
            "...BBBBB...",
            "..A.A.A.A..",
            ".A.......A.",
            "...........",
        ],
        work: [
            "A.........A",
            ".A.......A.",
            "...BBBBB...",
            ".CBBBBBBBC.",
            "..BBEBEBB..",
            "..CBBBBBC..",
            "..BBBBBBB..",
            "...BBBBB...",
            ".A.A.A.A.A.",
            "..A.....A..",
            "...........",
        ]
    )

    private static func glyph(for creature: MicroCreature) -> Glyph {
        switch creature {
        case .octopus: return octopus
        case .codex: return codex
        case .opencode: return opencode
        case .crayfish: return crayfish
        }
    }

    /// Dark status-color field so the bright creature pops. Amber awaiting pulses.
    static func statusBg(_ state: MicroAggregate, animFrame: Int) -> RGB {
        switch state {
        case .error: return (64, 18, 18)
        case .awaiting:
            let p = 0.78 + 0.22 * ((sin(Double(animFrame) * 0.25) + 1) / 2)
            return (UInt8(74 * p), UInt8(50 * p), UInt8(10 * p))
        case .processing: return (10, 28, 64)
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
        for y in 0..<size {
            let row = Array(grid[y])
            for x in 0..<size {
                guard let col = g.colors[row[x]] else { continue }
                let i = (y * size + x) * 3
                buf[i] = col.0; buf[i + 1] = col.1; buf[i + 2] = col.2
            }
        }
    }
}
#endif
