// DisplaySyncService.swift — Sync device brightness with host Mac display sleep/wake
//
// When the Mac display sleeps (hostDisplayOn=false), dims the device screen.
// When it wakes (hostDisplayOn=true), restores the previous brightness.
// The dim state remains authoritative until the host reports wake, the user
// disables sync, or the bridge disconnects. iOS does not expose a public API
// for third-party apps to lock the screen, so full-off means brightness 0 while
// the normal system auto-lock policy remains in effect.

import Foundation
import Combine
#if canImport(UIKit)
import UIKit
#endif

final class DisplaySyncService: ObservableObject, @unchecked Sendable {
    @Published var enabled = true {
        didSet {
            #if os(iOS)
            Task { @MainActor [weak self] in
                self?.applyDesiredState()
            }
            #endif
        }
    }

    #if os(iOS)
    private var savedBrightness: CGFloat?
    /// True while the screen is held dimmed by us — gates brightness capture so
    /// a live dim-level change (re-apply while host stays asleep) doesn't save
    /// the already-dimmed value as the "original".
    private var isDimmed = false
    /// Desired host state is retained across iOS background/foreground cycles.
    /// UIKit may reset screen brightness while the app is suspended, so the
    /// foreground path reapplies this state instead of relying on an edge event.
    private var desiredDisplayOn = true
    private var desiredDim: DisplayDimInstruction?
    #endif

    /// Resolve the brightness target for a display-state snapshot. `nil` means
    /// restore the user's brightness; 0 is the legacy/full-off behavior.
    /// Kept platform-neutral so macOS-hosted XCTest can cover iOS policy.
    static func resolvedBrightness(
        displayOn: Bool,
        syncEnabled: Bool,
        dim: DisplayDimInstruction?
    ) -> Double? {
        guard syncEnabled, !displayOn, dim?.enabled ?? true else { return nil }
        guard dim?.mode == "min" else { return 0 }
        return Double(max(1, min(100, dim?.level ?? 10))) / 100.0
    }

    /// Call when hostDisplayOn changes. `dim` carries the host's instruction
    /// (enabled / off vs min / level); absent ⇒ legacy full-off.
    func handleDisplayState(displayOn: Bool, dim: DisplayDimInstruction?) {
        #if os(iOS)
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.desiredDisplayOn = displayOn
            self.desiredDim = dim
            self.applyDesiredState()
        }
        #endif
    }

    #if os(iOS)
    /// Call when app returns to foreground
    func handleForegroundReturn(hostDisplayOn: Bool) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.desiredDisplayOn = hostDisplayOn
            self.applyDesiredState()
        }
    }

    /// Restore brightness on disconnect (safety net)
    func restoreOnDisconnect() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.desiredDisplayOn = true
            self.desiredDim = nil
            self.restoreBrightness()
        }
    }

    @MainActor
    private func applyDesiredState() {
        if let target = Self.resolvedBrightness(
            displayOn: desiredDisplayOn,
            syncEnabled: enabled,
            dim: desiredDim
        ) {
            if !isDimmed {
                // First dim — capture the user's brightness to restore later.
                // The isDimmed guard prevents a live level change (re-apply
                // while asleep) from saving the already-dimmed value.
                let current = UIScreen.main.brightness
                if current > 0.01 { savedBrightness = current }
                isDimmed = true
            }
            UIScreen.main.brightness = CGFloat(target)
        } else {
            // Display awake, sync disabled, or host disabled device dimming.
            restoreBrightness()
        }
    }

    @MainActor
    private func restoreBrightness() {
        if let saved = savedBrightness {
            UIScreen.main.brightness = saved
            savedBrightness = nil
        }
        isDimmed = false
    }
    #endif
}
