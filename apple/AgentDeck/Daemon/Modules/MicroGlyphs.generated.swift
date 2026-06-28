#if os(macOS)
// MicroGlyphs.generated.swift — AUTO-GENERATED, DO NOT EDIT.
//
// Source of truth: bridge/src/pixoo/micro-glyphs.ts
// Regenerate with: pnpm generate-micro-glyphs
//
// The grid/color tables below are emitted byte-for-byte from the TS glyph literals so
// the App Store macOS daemon and the Node CLI render identical Timebox Mini frames.
// Edit micro-glyphs.ts and re-run the generator — never hand-edit this file.

import Foundation

extension MicroGlyphs {
    // Keyed by the TS MicroCreature names; MicroGlyphs.glyph(for:) maps the Swift enum
    // (note: Swift .codex == TS "jellyfish").
    static let generatedGlyphs: [String: Glyph] = [
    "octopus": Glyph(
        colors: ["B": (235, 130, 90), "D": (150, 84, 64), "E": (255, 176, 64)],
        idle: [
            "...........",
            "..BBBBBBB..",
            "..BEEBEEB..",
            "..BBBBBBB..",
            "....BBB....",
            ".DBBBBBBBD.",
            ".DBBBBBBBD.",
            "..BBBBBBB..",
            "...BB.BB...",
            "...BB.BB...",
            "...........",
        ],
        work: [
            "...........",
            "..BBBBBBB..",
            "..BEEBEEB..",
            "..BBBBBBB..",
            "....BBB....",
            ".DBBBBBBBD.",
            ".DBBBBBBBD.",
            "..BBBBBBB..",
            "...BB.BB...",
            "..BB...BB..",
            "..D.....D..",
        ]
    ),
    "jellyfish": Glyph(
        colors: ["B": (120, 126, 236), "M": (238, 240, 255)],
        idle: [
            ".BB.BB.BB..",
            "BBBBBBBBBB.",
            "BBBBBBBBBBB",
            "BBBBBBBBBBB",
            "BBMBBBBBBBB",
            "BBBMMBBBBBB",
            "BBMBBBBBBBB",
            "BBBBBMMMBBB",
            "BBBBBBBBBBB",
            ".BBBBBBBBB.",
            "..B.BB.B...",
        ],
        work: nil
    ),
    "opencode": Glyph(
        colors: ["F": (232, 232, 232)],
        idle: [
            "...........",
            ".FFFFFF....",
            ".F....F....",
            ".F....F....",
            ".F..FFFFFF.",
            ".F..F...F..",
            ".FFFF...F..",
            "....F...F..",
            "....F...F..",
            "....FFFFFF.",
            "...........",
        ],
        work: nil
    ),
    "crayfish": Glyph(
        colors: ["B": (255, 92, 92), "C": (210, 52, 52), "A": (225, 180, 170), "E": (0, 229, 204)],
        idle: [
            "CC.......CC",
            "CC...A...CC",
            ".C..AAA..C.",
            "...BEBEB...",
            "...BBBBB...",
            "A..BBBBB..A",
            ".A.BBBBB.A.",
            "...BBBBB...",
            "...BBBBB...",
            "...BB.BB...",
            "..BB...BB..",
        ],
        work: [
            "CC.......CC",
            ".C...A...C.",
            "..C.AAA.C..",
            "...BEBEB...",
            "...BBBBB...",
            ".A.BBBBB.A.",
            "A..BBBBB..A",
            "...BBBBB...",
            "...BBBBB...",
            "...B.B.B...",
            "..BB...BB..",
        ]
    ),
    "antigravity": Glyph(
        colors: ["L": (92, 214, 77), "T": (31, 198, 179), "Q": (58, 199, 235), "Y": (245, 203, 36), "O": (255, 132, 16), "R": (255, 82, 65), "P": (183, 92, 182), "V": (102, 111, 225), "U": (36, 126, 255), "N": (41, 184, 238), "K": (0, 0, 0)],
        idle: [
            "....YOO....",
            "....YOO....",
            "...LYOOR...",
            "...LTORR...",
            "..LLTVPP...",
            "..TTKKVPP..",
            ".TQQK.KVU..",
            ".QQK...KUU.",
            "NQK.....KUU",
            "NN.......UU",
            "...........",
        ],
        work: [
            "...YYOO....",
            "...LYOOR...",
            "..LLYOOR...",
            "..LTTORR...",
            ".LTTTVPP...",
            ".TQQKKVPP..",
            "TQQK.KVUU..",
            "QQK...KUUU.",
            "NQK.....KUU",
            "N.........U",
            "...........",
        ]
    ),
    ]
}
#endif
