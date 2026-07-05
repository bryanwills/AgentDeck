// WearableTabletPreviews.swift — iPad, Android tablet mockups.
//
// Both are framed device schematics with the creature + HUD. Tablets show
// a secondary "sidebar" strip so the mockup reads as dashboard-style.

import SwiftUI

// MARK: - iPad (Landscape)

struct IPadLandscapePreview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 12) {
            DeviceBezel(cornerRadius: 24, bezelWidth: 12) {
                HStack(spacing: 8) {
                    PreviewMiniSessionList(selection: selection)
                        .frame(width: 108)
                    PreviewAquariumScene(selection: selection)
                    PreviewTopologyMini(selection: selection)
                        .frame(width: 116)
                }
            }
            .frame(width: 540, height: 330)
            Text("iPad landscape • dashboard")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Android Tablet (Lenovo-style)

struct AndroidTabletPreview: View {
    let selection: DevicePreviewSelection

    var body: some View {
        VStack(spacing: 12) {
            DeviceBezel(cornerRadius: 20, bezelWidth: 10, bezelColor: Color(white: 0.12)) {
                VStack(spacing: 6) {
                    HStack(spacing: 6) {
                        AgentDeckLogo(size: 12, color: TerrariumColors.tetraNeon)
                        Text("AgentDeck")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.84))
                        Spacer()
                        Text("\(selection.sessionCount) sessions")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.56))
                    }
                    HStack(spacing: 7) {
                        PreviewMiniSessionList(selection: selection, compact: true)
                            .frame(width: 96)
                        PreviewAquariumScene(selection: selection)
                        PreviewTopologyMini(selection: selection)
                            .frame(width: 122)
                    }
                }
            }
            .frame(width: 540, height: 320)
            Text("Android tablet • Lenovo / generic")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
        }
    }
}
