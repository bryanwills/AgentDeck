// BridgeDiscovery.swift — mDNS discovery for AgentDeck bridges
// Uses Network.framework NWBrowser (Apple native Bonjour)

import Foundation
import Network

struct DiscoveredBridge: Identifiable, Sendable {
    let name: String
    let host: String
    let port: Int
    let token: String?
    var project: String?
    var agentType: String?

    var id: String { "\(host):\(port)" }

    var wsUrl: String {
        var url = "ws://\(host):\(port)"
        if let token { url += "?token=\(token)" }
        return url
    }
}

@Observable
final class BridgeDiscovery: @unchecked Sendable {
    private(set) var bridges: [DiscoveredBridge] = []
    private(set) var isSearching = false

    private var browser: NWBrowser?
    private let queue = DispatchQueue(label: "dev.agentdeck.discovery")

    // MARK: - Start/Stop

    func startSearching() {
        guard browser == nil else { return }

        let params = NWParameters()
        params.includePeerToPeer = true

        let browser = NWBrowser(for: .bonjour(type: "_agentdeck._tcp", domain: nil), using: params)
        self.browser = browser

        browser.stateUpdateHandler = { [weak self] state in
            DispatchQueue.main.async {
                switch state {
                case .ready:
                    self?.isSearching = true
                case .failed, .cancelled:
                    self?.isSearching = false
                default:
                    break
                }
            }
        }

        browser.browseResultsChangedHandler = { [weak self] results, _ in
            self?.handleResults(results)
        }

        browser.start(queue: queue)
    }

    func stopSearching() {
        browser?.cancel()
        browser = nil
        DispatchQueue.main.async {
            self.isSearching = false
            self.bridges.removeAll()
        }
    }

    // MARK: - Result Handling

    private func handleResults(_ results: Set<NWBrowser.Result>) {
        var newBridges: [DiscoveredBridge] = []

        for result in results {
            guard case .service(let name, _, _, _) = result.endpoint else { continue }

            // Extract TXT metadata
            var token: String?
            var project: String?
            var agentType: String?
            var host: String?
            var port: Int?

            if case .bonjour(let txtRecord) = result.metadata {
                token = txtRecord.getDictionaryValue(for: "token")
                project = txtRecord.getDictionaryValue(for: "project")
                agentType = txtRecord.getDictionaryValue(for: "agent")
                host = txtRecord.getDictionaryValue(for: "ip")
                if let portStr = txtRecord.getDictionaryValue(for: "port") {
                    port = Int(portStr)
                }
            }
            port = port ?? 9120  // BridgeConstants.wsPort

            // For host, fall back to service name-based resolution
            if host == nil {
                // Will need NWConnection resolution for the actual host
                // For now, skip entries without explicit IP in TXT
                continue
            }

            guard let resolvedHost = host, !resolvedHost.hasPrefix("169.254.") else { continue }

            newBridges.append(DiscoveredBridge(
                name: name,
                host: resolvedHost,
                port: port ?? 9120,
                token: token,
                project: project,
                agentType: agentType
            ))
        }

        DispatchQueue.main.async {
            self.bridges = newBridges
        }
    }
}

// MARK: - NWTXTRecord helper

extension NWTXTRecord {
    func getDictionaryValue(for key: String) -> String? {
        guard let entry = getEntry(for: key) else { return nil }
        if case .string(let str) = entry {
            // entry is "key=value" format
            if let eqIdx = str.firstIndex(of: "=") {
                return String(str[str.index(after: eqIdx)...])
            }
            return str
        }
        return nil
    }
}
