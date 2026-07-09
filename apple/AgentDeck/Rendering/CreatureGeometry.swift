// CreatureGeometry.swift — Hand-maintained SwiftUI port of the canonical creature
// geometry SSOT `android/app/src/main/kotlin/dev/agentdeck/terrarium/CreatureGeometry.kt`.
//
// ⚠️ SSOT PORT — KEEP IN SYNC. The Kotlin `object CreatureGeometry` is the single
// source of truth for the terrarium creature vector geometry shared by the Compose
// tablet renderer and the e-ink native-Canvas renderer. This file re-transcribes the
// exact same `*_PATH_DATA` strings, viewBox sizes, and claw pivot points so the Apple
// device-preview / terrarium surfaces cannot silhouette-drift from the canonical
// robot / peak / crayfish. When `CreatureGeometry.kt` changes (path data, viewBox, or
// pivots), update the mirrored constants below in the SAME change.
//
// Faithful scope: the Kotlin SSOT only defines path geometry for THREE creatures —
//   • Octopus / Claude Code robot        (claudecode.svg,   viewBox 24)
//   • Antigravity peak / arc mark         (antigravity.svg,  viewBox 24)
//   • Crayfish / OpenClaw (body+claws+antennae, with claw pivots, viewBox 120)
// Codex and OpenCode have NO path geometry in the Kotlin SSOT — their terrarium
// creatures are drawn procedurally on Android. This port transcribes those procedural
// shapes too, from their canonical Compose implementations:
//   • Codex cloud — 6 overlapping lobes + center fill + `>_` prompt
//     (CloudCreature.kt LOBE_OFFSETS / LOBE_RADII / drawPrompt)
//   • OpenCode ring — hollow vertical rounded-rect ring, 16:20, thickness 0.28
//     (OpenCodeCreature.kt drawNestedSquares)
// so every agent renders its canonical creature, not a brand logo.
//
// Fill / stroke roles are taken from the canonical consumers (EinkRenderer.kt):
//   • Octopus path         → even-odd fill (the two inner rects are eye cutouts)
//   • Antigravity path     → fill
//   • Crayfish body & claws → fill; claws rotate about their pivots during animation
//   • Crayfish antennae     → stroke (round-cap, ~3px in the 120 viewBox space)
//
// Cross-platform: SwiftUI + CoreGraphics only (no AppKit / UIKit), so this compiles for
// both the macOS and iOS targets. The self-contained mini SVG-path parser below covers
// exactly the command set used by the SSOT paths (M L H V C S Q Z + relatives); it is
// intentionally local so the file has no cross-file dependency beyond SwiftUI.

import SwiftUI

// MARK: - Canonical geometry (mirrors CreatureGeometry.kt)

enum CreatureGeometry {

    // --- Octopus / Claude Code robot (claudecode.svg, viewBox 0 0 24 24) ---
    // fill-rule: evenodd — the two inner rects are transparent eye cutouts.
    static let octopusViewBox: CGFloat = 24
    static let octopusPathData =
        "M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"

    // --- Antigravity peak/arc mark (design/brand/antigravity.svg, viewBox 0 0 24 24) ---
    // Upward double-peak / mountain arc silhouette. SSOT mirror of
    // shared/src/svg-renderers/agent-logos.ts ANTIGRAVITY_PATH.
    static let antigravityViewBox: CGFloat = 24
    static let antigravityPathData =
        "M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z"

    // --- Crayfish / OpenClaw (openclaw.svg terrarium creature, viewBox 0 0 120 120) ---
    static let crayfishViewBox: CGFloat = 120
    static let crayfishBodyPathData =
        "M60 10c-30 0-45 25-45 45s15 40 30 45v10h10v-10s5 2 10 0v10h10v-10c15-5 30-25 30-45S90 10 60 10"
    static let crayfishLeftClawPathData =
        "M20 45C5 40 0 50 5 60s15 5 20-5c3-7 0-10-5-10"
    static let crayfishRightClawPathData =
        "M100 45c15-5 20 5 15 15s-15 5-20-5c-3-7 0-10 5-10"
    static let crayfishLeftAntennaPathData = "M45 15Q35 5 30 8"
    static let crayfishRightAntennaPathData = "M75 15Q85 5 90 8"

    /// Claw pivot points in the 120×120 viewBox (where each claw attaches to the body).
    static let crayfishLeftClawPivot = CGPoint(x: 20, y: 45)
    static let crayfishRightClawPivot = CGPoint(x: 100, y: 45)

    // --- Parsed Paths in viewBox coordinate space (mirrors the *NativePath accessors) ---

    static let octopusPath: Path = SVGPathParser.parse(octopusPathData)
    static let antigravityPath: Path = SVGPathParser.parse(antigravityPathData)
    static let crayfishBodyPath: Path = SVGPathParser.parse(crayfishBodyPathData)
    static let crayfishLeftClawPath: Path = SVGPathParser.parse(crayfishLeftClawPathData)
    static let crayfishRightClawPath: Path = SVGPathParser.parse(crayfishRightClawPathData)
    static let crayfishLeftAntennaPath: Path = SVGPathParser.parse(crayfishLeftAntennaPathData)
    static let crayfishRightAntennaPath: Path = SVGPathParser.parse(crayfishRightAntennaPathData)

    // MARK: - Layered creature model

    /// How a layer should be rasterized. Mirrors the `Paint.Style` / fill-rule choices
    /// made by the canonical consumers.
    enum FillRole {
        case fill
        case evenOddFill
        case stroke
        /// Stroked, but punched OUT of the layers below (destination-out) — used for
        /// the Codex `>_` prompt so it stays legible in a single-tint silhouette.
        case strokeCutout
    }

    /// A single drawable layer in the creature's own viewBox coordinate space.
    struct Layer {
        let path: Path
        let role: FillRole
        /// Rotation pivot in viewBox space (claws); nil for static layers.
        let pivot: CGPoint?
        /// Suggested stroke width in viewBox units (only meaningful for `.stroke`).
        let strokeWidth: CGFloat

        init(path: Path, role: FillRole, pivot: CGPoint? = nil, strokeWidth: CGFloat = 0) {
            self.path = path
            self.role = role
            self.pivot = pivot
            self.strokeWidth = strokeWidth
        }
    }

    /// A whole creature: its authoring viewBox plus its ordered layers.
    struct Creature {
        let viewBox: CGFloat
        let layers: [Layer]
    }

    /// Kinds that have canonical path geometry in the SSOT.
    private enum Kind {
        case octopus
        case antigravity
        case crayfish
        case cloud
        case ring
    }

    /// Normalizes the various agent-type spellings used across the codebase
    /// (`"claude"`, `"claude-code"`, `"codex-cli"`, `"openclaw"`, …) onto the
    /// creature kinds. Inlined here to keep the file self-contained.
    private static func kind(for agentType: String?) -> Kind? {
        switch agentType?.lowercased() {
        case "claude", "claude-code", "claudecode", "claude_code":
            return .octopus
        case "openclaw", "crayfish":
            return .crayfish
        case "antigravity":
            return .antigravity
        case "codex", "codex-cli", "codex-app":
            return .cloud
        case "opencode":
            return .ring
        default:
            return nil
        }
    }

    /// The canonical creature for an agent type, in its own viewBox coordinate space.
    /// Returns nil for agents without SSOT path geometry (Codex, OpenCode, unknown).
    static func creature(for agentType: String?) -> Creature? {
        switch kind(for: agentType) {
        case .octopus:
            return Creature(
                viewBox: octopusViewBox,
                layers: [Layer(path: octopusPath, role: .evenOddFill)]
            )
        case .antigravity:
            return Creature(
                viewBox: antigravityViewBox,
                layers: [Layer(path: antigravityPath, role: .fill)]
            )
        case .crayfish:
            return Creature(
                viewBox: crayfishViewBox,
                layers: [
                    Layer(path: crayfishBodyPath, role: .fill),
                    Layer(path: crayfishLeftClawPath, role: .fill, pivot: crayfishLeftClawPivot),
                    Layer(path: crayfishRightClawPath, role: .fill, pivot: crayfishRightClawPivot),
                    Layer(path: crayfishLeftAntennaPath, role: .stroke, strokeWidth: 3),
                    Layer(path: crayfishRightAntennaPath, role: .stroke, strokeWidth: 3),
                ]
            )
        case .cloud:
            return Creature(
                viewBox: cloudViewBox,
                layers: [
                    Layer(path: cloudBodyPath, role: .fill),
                    Layer(path: cloudPromptPath, role: .strokeCutout, strokeWidth: cloudPromptStroke),
                ]
            )
        case .ring:
            return Creature(
                viewBox: ringViewBox,
                layers: [Layer(path: ringPath, role: .evenOddFill)]
            )
        case .none:
            return nil
        }
    }

    // --- Codex cloud (procedural — mirrors CloudCreature.kt drawCloudBody/drawPrompt) ---
    //
    // 6 lobes as overlapping circles at LOBE_OFFSETS×bodyRadius with radii
    // LOBE_RADII×bodyRadius, plus the 0.18 center gap-fill circle. The `>_`
    // prompt is transcribed as a chevron + underscore stroke pair (the Compose
    // original draws text; a path keeps this file self-contained and 1-bit safe).
    static let cloudViewBox: CGFloat = 100
    private static let cloudBodyRadius: CGFloat = 40
    private static let cloudLobeOffsets: [(CGFloat, CGFloat)] = [
        (-0.14, -0.30),  // top-left
        (0.16, -0.26),   // top-right
        (0.32, -0.02),   // right
        (0.14, 0.26),    // bottom-right
        (-0.16, 0.26),   // bottom-left
        (-0.32, -0.02),  // left
    ]
    private static let cloudLobeRadii: [CGFloat] = [0.30, 0.29, 0.28, 0.29, 0.30, 0.28]
    static let cloudPromptStroke: CGFloat = 4.5

    static let cloudBodyPath: Path = {
        var p = Path()
        let c = CGPoint(x: 50, y: 50)
        for (i, offset) in cloudLobeOffsets.enumerated() {
            let r = cloudBodyRadius * cloudLobeRadii[i]
            let center = CGPoint(x: c.x + cloudBodyRadius * offset.0, y: c.y + cloudBodyRadius * offset.1)
            p.addEllipse(in: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2))
        }
        // Central fill circle to cover any inter-lobe gaps (0.18 × bodyRadius).
        let cr = cloudBodyRadius * 0.18
        p.addEllipse(in: CGRect(x: c.x - cr, y: c.y - cr, width: cr * 2, height: cr * 2))
        return p
    }()

    static let cloudPromptPath: Path = {
        var p = Path()
        let c = CGPoint(x: 50, y: 50)
        let r = cloudBodyRadius
        // ">" chevron
        p.move(to: CGPoint(x: c.x - 0.22 * r, y: c.y - 0.16 * r))
        p.addLine(to: CGPoint(x: c.x - 0.04 * r, y: c.y))
        p.addLine(to: CGPoint(x: c.x - 0.22 * r, y: c.y + 0.16 * r))
        // "_" underscore
        p.move(to: CGPoint(x: c.x + 0.04 * r, y: c.y + 0.16 * r))
        p.addLine(to: CGPoint(x: c.x + 0.26 * r, y: c.y + 0.16 * r))
        return p
    }()

    // --- OpenCode ring (procedural — mirrors OpenCodeCreature.kt drawNestedSquares) ---
    //
    // Canonical opencode mark: a vertical rectangular RING (16:20) with a hollow
    // center. rectW = 0.80×size, thickness = 0.28×rectW, cornerR = 0.05×size.
    static let ringViewBox: CGFloat = 100
    static let ringPath: Path = {
        let size: CGFloat = 96
        let rectW = size * 0.80
        let rectH = size
        let thick = rectW * 0.28
        let cornerR = size * 0.05
        let outer = CGRect(x: 50 - rectW / 2, y: 50 - rectH / 2, width: rectW, height: rectH)
        let inner = outer.insetBy(dx: thick, dy: thick)
        var p = Path()
        p.addRoundedRect(in: outer, cornerSize: CGSize(width: cornerR, height: cornerR))
        p.addRoundedRect(in: inner, cornerSize: CGSize(width: max(1, cornerR - thick * 0.5), height: max(1, cornerR - thick * 0.5)))
        return p
    }()

    // MARK: - Rect-fitted convenience

    /// The affine transform that fits a creature's square viewBox centered into `rect`
    /// (aspect-preserving, `min` scale — same fit the Compose/Canvas surfaces use).
    static func fitTransform(viewBox: CGFloat, in rect: CGRect) -> CGAffineTransform {
        guard viewBox > 0 else { return .identity }
        let scale = min(rect.width, rect.height) / viewBox
        let drawn = viewBox * scale
        let originX = rect.minX + (rect.width - drawn) / 2
        let originY = rect.minY + (rect.height - drawn) / 2
        return CGAffineTransform(translationX: originX, y: originY)
            .scaledBy(x: scale, y: scale)
    }

    /// Convenience: the union of the creature's *fillable* layers, transformed to fit
    /// `rect`. Stroke-only layers (crayfish antennae) are omitted because unioning an
    /// open path into a fill silhouette would be wrong — use `creature(for:)` +
    /// `CanonicalCreatureView` when you need the antennae. Returns nil for agents
    /// without SSOT geometry.
    static func path(for agentType: String?, in rect: CGRect) -> Path? {
        guard let creature = creature(for: agentType) else { return nil }
        let transform = fitTransform(viewBox: creature.viewBox, in: rect)
        var combined = Path()
        for layer in creature.layers where layer.role != .stroke {
            combined.addPath(layer.path.applying(transform))
        }
        return combined.isEmpty ? nil : combined
    }

    /// True when the agent has canonical creature geometry to render.
    static func hasGeometry(for agentType: String?) -> Bool {
        kind(for: agentType) != nil
    }
}

// MARK: - SwiftUI Shape / View

/// A SwiftUI `Shape` that emits the fillable silhouette of an agent's canonical creature,
/// fitted to the drawing rect. Yields an empty path for agents without SSOT geometry, so
/// it can be used directly as `.fill(...)` in a layout without crashing.
struct CanonicalCreatureShape: Shape {
    let agentType: String?

    func path(in rect: CGRect) -> Path {
        CreatureGeometry.path(for: agentType, in: rect) ?? Path()
    }
}

/// Drop-in preview view that renders an agent's canonical creature (all layers, with the
/// correct even-odd fill and stroked antennae) tinted a single `color`. Mirrors the
/// single-tint silhouette treatment used by the terrarium/e-ink surfaces. All five agents
/// render: robot, cloud+`>_`, ring, crayfish, peak. Unknown agents render nothing.
struct CanonicalCreatureView: View {
    let agentType: String?
    var size: CGFloat = 64
    var color: Color = .primary

    var body: some View {
        Canvas { context, canvasSize in
            guard let creature = CreatureGeometry.creature(for: agentType) else { return }
            let rect = CGRect(origin: .zero, size: canvasSize)
            let transform = CreatureGeometry.fitTransform(viewBox: creature.viewBox, in: rect)
            let scale = min(canvasSize.width, canvasSize.height) / creature.viewBox

            // Layers composite in an offscreen pass so `.strokeCutout` can punch
            // through the body without erasing whatever is behind the view.
            context.drawLayer { layerCtx in
                for layer in creature.layers {
                    let transformed = layer.path.applying(transform)
                    switch layer.role {
                    case .fill:
                        layerCtx.fill(transformed, with: .color(color))
                    case .evenOddFill:
                        layerCtx.fill(transformed, with: .color(color), style: FillStyle(eoFill: true))
                    case .stroke, .strokeCutout:
                        if layer.role == .strokeCutout {
                            layerCtx.blendMode = .destinationOut
                        }
                        layerCtx.stroke(
                            transformed,
                            with: .color(color),
                            style: StrokeStyle(
                                lineWidth: max(0.5, layer.strokeWidth * scale),
                                lineCap: .round,
                                lineJoin: .round
                            )
                        )
                        layerCtx.blendMode = .normal
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(Self.accessibilityLabel(for: agentType))
    }

    private static func accessibilityLabel(for agentType: String?) -> String {
        switch agentType?.lowercased() {
        case "claude", "claude-code", "claudecode", "claude_code":
            return "Claude Code creature"
        case "codex", "codex-cli", "codex-app":
            return "Codex cloud creature"
        case "opencode":
            return "OpenCode ring creature"
        case "openclaw", "crayfish":
            return "OpenClaw crayfish creature"
        case "antigravity":
            return "Antigravity creature"
        default:
            return "Agent creature"
        }
    }
}

// MARK: - Self-contained SVG path parser

/// Minimal SVG path-data parser covering exactly the command set used by the canonical
/// creature paths: M/m L/l H/h V/v C/c S/s Q/q T/t Z/z. Kept local so this file has no
/// cross-file dependency. (The SSOT paths use no elliptical-arc `A/a` commands, so arc
/// support is intentionally omitted.)
enum SVGPathParser {

    private enum Token {
        case command(Character)
        case number(CGFloat)
    }

    static func parse(_ data: String) -> Path {
        let tokens = tokenize(data)
        var path = Path()

        var current = CGPoint.zero      // current point
        var subpathStart = CGPoint.zero // start of current subpath (for Z)
        var lastCubicControl = CGPoint.zero
        var lastQuadControl = CGPoint.zero
        var previousCommand: Character = " "
        var currentCommand: Character = " "

        var index = 0

        func nextNumber() -> CGFloat {
            while index < tokens.count {
                let token = tokens[index]
                index += 1
                if case let .number(value) = token { return value }
            }
            return 0
        }

        while index < tokens.count {
            if case let .command(command) = tokens[index] {
                currentCommand = command
                index += 1
                if command == "Z" || command == "z" {
                    path.closeSubpath()
                    current = subpathStart
                    previousCommand = command
                    continue
                }
            } else {
                // Implicit command repetition: extra coordinate sets after an M/m are
                // treated as L/l; every other command simply repeats itself.
                if currentCommand == "M" { currentCommand = "L" }
                else if currentCommand == "m" { currentCommand = "l" }
            }

            let relative = currentCommand.isLowercase
            let base = relative ? current : CGPoint.zero

            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: base.x + x, y: base.y + y)
            }

            switch currentCommand {
            case "M", "m":
                let p = point(nextNumber(), nextNumber())
                path.move(to: p)
                current = p
                subpathStart = p

            case "L", "l":
                let p = point(nextNumber(), nextNumber())
                path.addLine(to: p)
                current = p

            case "H", "h":
                let x = nextNumber()
                let p = CGPoint(x: (relative ? current.x : 0) + x, y: current.y)
                path.addLine(to: p)
                current = p

            case "V", "v":
                let y = nextNumber()
                let p = CGPoint(x: current.x, y: (relative ? current.y : 0) + y)
                path.addLine(to: p)
                current = p

            case "C", "c":
                let c1 = point(nextNumber(), nextNumber())
                let c2 = point(nextNumber(), nextNumber())
                let end = point(nextNumber(), nextNumber())
                path.addCurve(to: end, control1: c1, control2: c2)
                lastCubicControl = c2
                current = end

            case "S", "s":
                let smooth = "CcSs".contains(previousCommand)
                let c1 = smooth
                    ? CGPoint(x: 2 * current.x - lastCubicControl.x,
                              y: 2 * current.y - lastCubicControl.y)
                    : current
                let c2 = point(nextNumber(), nextNumber())
                let end = point(nextNumber(), nextNumber())
                path.addCurve(to: end, control1: c1, control2: c2)
                lastCubicControl = c2
                current = end

            case "Q", "q":
                let c = point(nextNumber(), nextNumber())
                let end = point(nextNumber(), nextNumber())
                path.addQuadCurve(to: end, control: c)
                lastQuadControl = c
                current = end

            case "T", "t":
                let smooth = "QqTt".contains(previousCommand)
                let c = smooth
                    ? CGPoint(x: 2 * current.x - lastQuadControl.x,
                              y: 2 * current.y - lastQuadControl.y)
                    : current
                let end = point(nextNumber(), nextNumber())
                path.addQuadCurve(to: end, control: c)
                lastQuadControl = c
                current = end

            default:
                // Unknown command — advance defensively to avoid an infinite loop.
                index += 1
            }

            previousCommand = currentCommand
        }

        return path
    }

    private static func tokenize(_ data: String) -> [Token] {
        var tokens: [Token] = []
        let chars = Array(data)
        var i = 0

        while i < chars.count {
            let c = chars[i]
            if c.isLetter {
                tokens.append(.command(c))
                i += 1
            } else if c == " " || c == "," || c == "\n" || c == "\t" || c == "\r" {
                i += 1
            } else if c == "-" || c == "+" || c == "." || c.isNumber {
                var s = ""
                var seenDot = false
                if c == "-" || c == "+" {
                    s.append(c)
                    i += 1
                }
                while i < chars.count {
                    let ch = chars[i]
                    if ch.isNumber {
                        s.append(ch)
                        i += 1
                    } else if ch == "." && !seenDot {
                        seenDot = true
                        s.append(ch)
                        i += 1
                    } else if ch == "e" || ch == "E" {
                        s.append(ch)
                        i += 1
                        if i < chars.count, chars[i] == "-" || chars[i] == "+" {
                            s.append(chars[i])
                            i += 1
                        }
                    } else {
                        break
                    }
                }
                tokens.append(.number(CGFloat(Double(s) ?? 0)))
            } else {
                i += 1
            }
        }

        return tokens
    }
}

// MARK: - Preview

#if DEBUG
#Preview("Canonical creatures") {
    HStack(spacing: 24) {
        VStack {
            CanonicalCreatureView(agentType: "claude-code", size: 96,
                                  color: Color(red: 0.753, green: 0.439, blue: 0.345))
            Text("octopus").font(.caption2)
        }
        VStack {
            CanonicalCreatureView(agentType: "openclaw", size: 96,
                                  color: Color(red: 1.0, green: 0.30, blue: 0.30))
            Text("crayfish").font(.caption2)
        }
        VStack {
            CanonicalCreatureView(agentType: "antigravity", size: 96,
                                  color: Color(red: 0.373, green: 0.388, blue: 0.408))
            Text("antigravity").font(.caption2)
        }
    }
    .padding()
    .background(Color.black)
}
#endif
