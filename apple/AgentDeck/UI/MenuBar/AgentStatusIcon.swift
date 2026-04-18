// AgentStatusIcon.swift — Menu bar label: AgentDeck logo + composite agent dots
// Design from `explore/menubar-icons.jsx::MBComposite`.
//
// Rendering gotcha: `MenuBarExtra { … } label: { … }` does NOT render
// arbitrary SwiftUI content reliably. Canvas-based views measure as zero
// size, HStack children with conditional branches get dropped, and the
// icon disappears altogether. Apple's own guidance is "use a simple
// `Image` or `Label` as the label." We honor that by building the
// composite view in a hidden SwiftUI hierarchy, rasterizing it via
// `ImageRenderer` into an `NSImage`, and handing the menu bar a plain
// `Image` as the label — which renders the way any other status item
// does, and also picks up the system's automatic dark-mode tint because
// we mark the NSImage as a template.

#if os(macOS)
import SwiftUI
import AppKit

struct AgentStatusIcon: View {
    let sessions: [SessionInfo]
    let bridgeConnected: Bool

    @State private var renderedImage: NSImage? = nil
    @State private var pulseTick: Bool = false

    var body: some View {
        Group {
            if let img = renderedImage {
                Image(nsImage: img)
            } else {
                // Placeholder during the first render — SF Symbol is guaranteed
                // to display, which keeps the menubar slot visible even if
                // ImageRenderer hasn't fired yet.
                Image(systemName: "square.stack.3d.up")
            }
        }
        .onAppear { refreshIcon() }
        .onChange(of: compositeSignature) { _, _ in refreshIcon() }
        // Pulse timer: drives the awaiting-agent dot opacity. 1.1s cycle
        // matches the JS prototype's `mbPulse` animation. We only schedule
        // the timer when there is something to pulse, to avoid unnecessary
        // menubar redraws when the app is idle.
        .onReceive(
            Timer.publish(every: 0.55, on: .main, in: .common).autoconnect()
        ) { _ in
            if hasAwaitingAgent {
                pulseTick.toggle()
                refreshIcon()
            } else if pulseTick {
                pulseTick = false
                refreshIcon()
            }
        }
    }

    /// Signature of the inputs that should invalidate the rendered image.
    /// Re-render only when the bridge state or the agent-dot set changes —
    /// not on every sibling-session mutation.
    private var compositeSignature: String {
        let parts = composedDots().shown.map {
            "\($0.id):\($0.awaiting ? "a" : "p")"
        }
        return "\(bridgeConnected)|\(parts.joined(separator: ","))|\(composedDots().overflow)|\(pulseTick)"
    }

    private var hasAwaitingAgent: Bool {
        composedDots().shown.contains { $0.awaiting }
    }

    private func refreshIcon() {
        let dots = composedDots()
        let view = IconComposite(
            bridgeConnected: bridgeConnected,
            dots: dots.shown,
            overflow: dots.overflow,
            pulseDim: pulseTick
        )
        // `ImageRenderer` was introduced in macOS 13. AgentDeck already
        // targets macOS 14+, so we can use it unconditionally.
        let renderer = ImageRenderer(content: view)
        renderer.scale = NSScreen.main?.backingScaleFactor ?? 2.0
        if let cg = renderer.cgImage {
            let size = NSSize(width: IconComposite.renderWidth, height: IconComposite.renderHeight)
            let img = NSImage(cgImage: cg, size: size)
            img.isTemplate = true  // let the system apply menubar tinting
            renderedImage = img
        }
    }

    // MARK: - Dot composition

    fileprivate struct Dot: Equatable {
        let id: String
        let nsColor: NSColor
        let awaiting: Bool
    }

    private func composedDots() -> (shown: [Dot], overflow: Int) {
        guard bridgeConnected else { return ([], 0) }
        var seen = Set<String>()
        let candidates: [Dot] = sessions
            .filter { $0.alive }
            .compactMap { session -> Dot? in
                let state = AgentConnectionState(rawValue: session.state ?? "idle") ?? .idle
                guard state == .processing || state.isAwaiting else { return nil }
                let key = session.agentType ?? session.id
                if seen.contains(key) { return nil }
                seen.insert(key)
                return Dot(
                    id: key,
                    nsColor: SessionBrand.nsColor(for: session.agentType),
                    awaiting: state.isAwaiting
                )
            }
            .sorted { a, b in a.awaiting && !b.awaiting }
        let cap = 3
        return (Array(candidates.prefix(cap)), max(0, candidates.count - cap))
    }
}

/// Pure SwiftUI composition that gets rasterized into the menu bar icon.
/// Keeps all layout decisions in one place so `ImageRenderer` has a known
/// canvas size to work with (important — menubar icons must be ~18pt tall).
private struct IconComposite: View {
    let bridgeConnected: Bool
    let dots: [AgentStatusIcon_DotProxy]
    let overflow: Int
    let pulseDim: Bool

    static let renderHeight: CGFloat = 18
    /// Concrete composite width — `ImageRenderer` refuses to emit a
    /// `cgImage` when the content width is ambiguous, which manifested as
    /// an *invisible* status item. Keep it wider than the maximum
    /// composite content (logo 16 + 4 + 3 dots × 7 + 2 × 2 + overflow
    /// "+99" ≈ 64pt) and align content `.leading` so trailing padding
    /// reads as empty bar space instead of a stretched glyph.
    static let renderWidth: CGFloat = 68

    init(
        bridgeConnected: Bool,
        dots: [AgentStatusIcon.Dot] = [],
        overflow: Int = 0,
        pulseDim: Bool = false
    ) {
        self.bridgeConnected = bridgeConnected
        self.dots = dots.map { AgentStatusIcon_DotProxy(id: $0.id, color: Color(nsColor: $0.nsColor), awaiting: $0.awaiting) }
        self.overflow = overflow
        self.pulseDim = pulseDim
    }

    var body: some View {
        HStack(spacing: 4) {
            AgentDeckLogo(size: 16, color: .black)
                .opacity(bridgeConnected ? 1.0 : 0.45)

            if !dots.isEmpty {
                HStack(spacing: 2) {
                    ForEach(dots) { dot in
                        Circle()
                            .fill(dot.color)
                            .frame(width: 7, height: 7)
                            .opacity(dot.awaiting && pulseDim ? 0.4 : 1.0)
                    }
                    if overflow > 0 {
                        // `Text("+\(overflow)")` would localize the integer
                        // (ko-KR → "+1,234") — guard with `verbatim`.
                        Text(verbatim: "+\(overflow)")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.black)
                    }
                }
            } else if !bridgeConnected {
                Circle()
                    .fill(Color.red)
                    .frame(width: 5, height: 5)
            }
        }
        .padding(.horizontal, 2)
        .frame(width: Self.renderWidth, height: Self.renderHeight, alignment: .leading)
    }
}

/// Light-weight dot proxy usable across rendering contexts. `Identifiable`
/// so `ForEach` can diff by agent id (one Claude session → one dot).
private struct AgentStatusIcon_DotProxy: Identifiable {
    let id: String
    let color: Color
    let awaiting: Bool
}

// MARK: - NSColor bridge for brand colors

/// `SessionBrand.color` returns `Color` (SwiftUI) but the menubar render
/// path needs `NSColor` for the underlying bitmap. Mirror the same palette
/// here so `SessionBrand` doesn't have to grow an `NSColor` API just for
/// this call site.
extension SessionBrand {
    static func nsColor(for agentType: String?) -> NSColor {
        switch agentType {
        case "claude-code": return NSColor(red: 0.753, green: 0.439, blue: 0.345, alpha: 1)
        case "codex-cli":   return NSColor(red: 0.38,  green: 0.40,  blue: 0.88,  alpha: 1)
        case "openclaw":    return NSColor(red: 1.0,   green: 0.30,  blue: 0.30,  alpha: 1)
        case "opencode":    return NSColor(red: 0.945, green: 0.925, blue: 0.925, alpha: 1)
        case "daemon":      return NSColor(red: 0.55,  green: 0.55,  blue: 0.60,  alpha: 1)
        default:            return NSColor.secondaryLabelColor
        }
    }
}
#endif
