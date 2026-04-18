// DaemonOfflineAffordance.swift — visual hint for disabled-because-daemon-offline buttons
//
// `.disabled(...)` alone dims SwiftUI buttons very subtly; in the menu bar
// popup, a disabled pill is hard to distinguish from an enabled one and
// reads as "broken button" rather than "gated by state". This modifier
// paints a consistent affordance across every menu bar control that is
// blocked by the daemon being offline:
//   - opacity drop to 0.45
//   - small trailing warning glyph
//   - tooltip (`.help`) explaining the cause
//
// Pair with an actual `.disabled(...)` call — the modifier is purely
// visual and does not change button enablement on its own.

#if os(macOS)
import SwiftUI

extension View {
    /// Decorates a control so that, when the daemon is offline, it reads
    /// unambiguously as "temporarily unavailable because the daemon is
    /// down" rather than "broken button".
    @ViewBuilder
    func daemonOfflineAffordance(isOffline: Bool) -> some View {
        if isOffline {
            self
                .opacity(0.45)
                .overlay(alignment: .trailing) {
                    Image(systemName: "exclamationmark.circle")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(.orange)
                        .offset(x: 6, y: -6)
                }
                .help("Daemon offline — Restart from the banner or Settings.")
        } else {
            self
        }
    }
}
#endif
