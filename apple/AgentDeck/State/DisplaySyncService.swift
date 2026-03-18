// DisplaySyncService.swift — Sync device brightness with host Mac display sleep/wake
//
// When the Mac display sleeps (hostDisplayOn=false), dims the device screen.
// When it wakes (hostDisplayOn=true), restores the previous brightness.

import Foundation
#if canImport(UIKit)
import UIKit
#endif

@Observable
final class DisplaySyncService: @unchecked Sendable {
    var enabled = true

    #if os(iOS)
    private var savedBrightness: CGFloat?
    private var pendingDim = false
    #endif

    /// Call when hostDisplayOn changes
    func handleDisplayState(displayOn: Bool, isAppActive: Bool) {
        guard enabled else { return }

        #if os(iOS)
        if !displayOn {
            if isAppActive {
                let current = UIScreen.main.brightness
                savedBrightness = current
                UIScreen.main.brightness = 0.0
                pendingDim = false
            } else {
                pendingDim = true
            }
        } else {
            pendingDim = false
            if let saved = savedBrightness {
                UIScreen.main.brightness = saved
                savedBrightness = nil
            }
        }
        #endif
    }

    #if os(iOS)
    /// Call when app returns to foreground
    func handleForegroundReturn(hostDisplayOn: Bool) {
        guard enabled else { return }
        if pendingDim && !hostDisplayOn {
            savedBrightness = UIScreen.main.brightness
            UIScreen.main.brightness = 0.0
            pendingDim = false
        }
    }

    /// Restore brightness on disconnect (safety net)
    func restoreOnDisconnect() {
        pendingDim = false
        if let saved = savedBrightness {
            UIScreen.main.brightness = saved
            savedBrightness = nil
        }
    }
    #endif
}
