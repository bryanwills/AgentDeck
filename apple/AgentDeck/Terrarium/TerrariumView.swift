// TerrariumView.swift — 60fps animated aquarium using TimelineView + Canvas

import SwiftUI

struct TerrariumView: View {
    let terrariumState: TerrariumState

    /// Optional tap handler: receives the session ID of the tapped creature (macOS only)
    var onCreatureTapped: ((String) -> Void)?

    @State private var renderer = TerrariumRenderer()

    var body: some View {
        // Cap at 60fps — 120Hz is excessive for a monitoring aquarium and wastes memory/battery
        TimelineView(.animation(minimumInterval: 1.0 / 60)) { timeline in
            Canvas { context, size in
                // deltaTime stored in renderer (plain class) to avoid @State mutation
                // which would trigger double SwiftUI re-renders at 120Hz → OOM
                let dt = renderer.deltaTime(now: timeline.date)

                renderer.update(dt: dt, state: terrariumState)
                renderer.draw(context: &context, size: size)
            }
            #if os(macOS)
            .onTapGesture { location in
                guard let handler = onCreatureTapped else { return }
                // Canvas is sized to the full view — get size from GeometryReader parent
                // Since Canvas fills its proposed size, we use the timeline's canvas size
                // We need GeometryReader to know the actual size for normalization
            }
            #endif
        }
        #if os(macOS)
        .overlay {
            if onCreatureTapped != nil {
                GeometryReader { geo in
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture { location in
                            let nx = Float(location.x / geo.size.width)
                            let ny = Float(location.y / geo.size.height)
                            if let sessionId = renderer.creatureAtPoint(nx: nx, ny: ny) {
                                onCreatureTapped?(sessionId)
                            }
                        }
                }
            }
        }
        #endif
    }
}
