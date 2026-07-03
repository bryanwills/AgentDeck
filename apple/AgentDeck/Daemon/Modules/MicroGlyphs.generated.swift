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
        colors: ["B": (235, 130, 90), "D": (150, 84, 64), "K": (0, 0, 0), "E": (120, 226, 255)],
        idle: [
            "...........",
            ".BBBBBBBBB.",
            ".BBBBBBBBB.",
            ".BBKBBBKBB.",
            ".BBKBBBKBB.",
            "BBBBBBBBBBB",
            "BBBBBBBBBBB",
            ".BBBBBBBBB.",
            "..BB...BB..",
            "..BB...BB..",
            "...........",
        ],
        work: [
            "...........",
            ".BBBBBBBBB.",
            ".BBBBBBBBB.",
            ".BBEBBBEBB.",
            ".BBEBBBEBB.",
            "BBBBBBBBBBB",
            "BBBBBBBBBBB",
            ".BBBBBBBBB.",
            "..BB...BB..",
            "...B...BB..",
            "...........",
        ]
    ),
    "jellyfish": Glyph(
        colors: ["B": (86, 92, 220), "M": (255, 255, 255)],
        idle: [
            "...........",
            "...BBBBB...",
            ".BBBBBBBBB.",
            "BBBBBBBBBBB",
            "BBMMBBBBBBB",
            "BBBMMBBBBBB",
            "BBMMBBBBBBB",
            "BBBBBBBBBBB",
            "BBBMMMMMBBB",
            ".BBBBBBBBB.",
            "...BBBBB...",
        ],
        work: [
            "...........",
            "...BBBBB...",
            ".BBBBBBBBB.",
            "BBBBBBBBBBB",
            "BBMMBBBBBBB",
            "BBBMMBBBBBB",
            "BBMMBBBBBBB",
            "BBBBBBBBBBB",
            "BBBBBBBBBBB",
            ".BBBBBBBBB.",
            "...BBBBB...",
        ]
    ),
    "opencode": Glyph(
        colors: ["F": (232, 232, 232)],
        idle: [
            "...........",
            "..FFFFFFF..",
            "..FFFFFFF..",
            "..FF...FF..",
            "..FF...FF..",
            "..FF...FF..",
            "..FF...FF..",
            "..FF...FF..",
            "..FFFFFFF..",
            "..FFFFFFF..",
            "...........",
        ],
        work: [
            "...........",
            "..FFFFFFF..",
            "..FFFFFFF..",
            "..FFF.FFF..",
            "..FFF.FFF..",
            "..FFF.FFF..",
            "..FFF.FFF..",
            "..FFF.FFF..",
            "..FFFFFFF..",
            "..FFFFFFF..",
            "...........",
        ]
    ),
    "crayfish": Glyph(
        colors: ["B": (255, 92, 92), "C": (210, 52, 52), "A": (225, 180, 170), "E": (0, 229, 204)],
        idle: [
            "...A...A...",
            "....A.A....",
            "....BBB....",
            "...BEBEB...",
            "C.BBBBBBB.C",
            "CC.BBBBB.CC",
            ".CBBBBBBB.C",
            "..BBBBBBB..",
            "...BBBBB...",
            "...BB.BB...",
            "..BB...BB..",
        ],
        work: [
            "....A.A....",
            "...A...A...",
            "....BBB....",
            "...BEBEB...",
            ".CBBBBBBB.C",
            "CC.BBBBB.CC",
            "C.BBBBBBB.C",
            "..BBBBBBB..",
            "...BBBBB...",
            "...B.B.B...",
            "..BB...BB..",
        ]
    ),
    "antigravity": Glyph(
        colors: ["L": (92, 214, 77), "T": (31, 198, 179), "Q": (58, 199, 235), "Y": (245, 203, 36), "O": (255, 132, 16), "R": (255, 82, 65), "P": (183, 92, 182), "V": (102, 111, 225), "U": (36, 126, 255), "N": (41, 184, 238)],
        idle: [
            ".....O.....",
            "....YOR....",
            "...LYORP...",
            "...LYORPV..",
            "...LTQRPV..",
            "..LTQRPVU..",
            "..TQ...VU..",
            "..Q.....U..",
            ".NQ.....UU.",
            ".N.......UU",
            "...........",
        ],
        work: [
            "....YO.....",
            "....YORP...",
            "...LYORPV..",
            "...LTQRPV..",
            "..LTQRPVU..",
            "..TQ...VU..",
            "..Q.....U..",
            ".NQ.....UU.",
            ".N.......UU",
            "...........",
            "...........",
        ]
    ),
    ]
}
#endif
