// DisplaySyncService.swift — Sync device brightness with host Mac display sleep/wake
//
// When the Mac display sleeps (hostDisplayOn=false), dims the device screen.
// When it wakes (hostDisplayOn=true), restores the previous brightness.
// The dim state remains authoritative until the host reports wake, the user
// disables sync, or the bridge disconnects. iOS does not expose a public API
// for third-party apps to lock the screen, so full-off means brightness 0.
//
// The service also owns the idle-timer hold: while the host display is on the
// device is kept awake, and the hold is released when the host sleeps so the
// device may auto-lock normally.

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
        applyIdleTimerPolicy()
    }

    /// Hold the screen awake while the host display is on.
    ///
    /// A wall-mounted dashboard that auto-locks after the device's Auto-Lock
    /// interval stops being a dashboard — which is what happened: the iPhone
    /// slept on its own with the Mac display still on, while an iPad set to
    /// Auto-Lock "Never" looked fine. Nothing in the app touched
    /// isIdleTimerDisabled, so the system timer always won. Android already has
    /// this as FLAG_KEEP_SCREEN_ON driven by its keepAwake preference.
    ///
    /// Scoped to `enabled`: if the user turned display sync off we leave their
    /// device's power behavior alone rather than silently pinning it awake. When
    /// the host sleeps we release the hold, so the device may auto-lock — that
    /// complements dimming rather than fighting it.
    @MainActor
    private func applyIdleTimerPolicy() {
        UIApplication.shared.isIdleTimerDisabled = enabled && desiredDisplayOn
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
