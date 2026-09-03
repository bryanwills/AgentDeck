#if os(macOS)
// ApmeGraphProjection.swift — read-only property-graph view of APME rows.
// Mirrors bridge/src/apme/graph.ts so the self-contained dashboard's Graph
// tab works whichever daemon owns port 9120.

import Foundation

enum ApmeGraphProjection {
    struct Options {
        var limit = 60
        var agentType: String?
        var projectName: String?
        var category: String?
        var includeTurns = true
        var includeFiles = true
        var minHubDegree = 2
    }

    private final class Builder {
        var nodes: [String: [String: Any]] = [:]
        var edges: [String: [String: Any]] = [:]

        @discardableResult
        func node(_ value: [String: Any]) -> String {
            guard let id = value["id"] as? String else { return "" }
            if var existing = nodes[id] {
                if existing["ts"] == nil, let ts = value["ts"] { existing["ts"] = ts }
                if existing["score"] == nil, let score = value["score"] { existing["score"] = score }
                if let incoming = value["meta"] as? [String: Any] {
                    var meta = existing["meta"] as? [String: Any] ?? [:]
                    for (key, val) in incoming { meta[key] = val }
                    existing["meta"] = meta
                }
                nodes[id] = existing
            } else {
                nodes[id] = value
            }
            return id
        }

        func edge(_ from: String, _ to: String, _ kind: String) {
            guard !from.isEmpty, !to.isEmpty else { return }
            let key = "\(from)|\(to)|\(kind)"
            if var existing = edges[key] {
                existing["weight"] = (existing["weight"] as? Int ?? 1) + 1
                edges[key] = existing
            } else {
                edges[key] = ["from": from, "to": to, "kind": kind, "weight": 1]
            }
        }

        func pruneHubs(minDegree: Int) {
            guard minDegree > 1 else { return }
            let degree = degrees()
            let dropped = Set(nodes.compactMap { id, node -> String? in
                guard let kind = node["kind"] as? String,
                      kind == "tool" || kind == "file",
                      (degree[id] ?? 0) < minDegree else { return nil }
                return id
            })
            guard !dropped.isEmpty else { return }
            for id in dropped { nodes.removeValue(forKey: id) }
            edges = edges.filter { _, edge in
                guard let from = edge["from"] as? String,
                      let to = edge["to"] as? String else { return false }
                return !dropped.contains(from) && !dropped.contains(to)
            }
        }

        func finish() -> (nodes: [[String: Any]], edges: [[String: Any]]) {
            let degree = degrees()
            let outNodes = nodes.map { id, raw -> [String: Any] in
                var value = raw
                value["degree"] = degree[id] ?? 0
                return value
            }
            return (outNodes, Array(edges.values))
        }

        private func degrees() -> [String: Int] {
            var out: [String: Int] = [:]
            for edge in edges.values {
                if let from = edge["from"] as? String { out[from, default: 0] += 1 }
                if let to = edge["to"] as? String { out[to, default: 0] += 1 }
            }
            return out
        }
    }

    static func build(store: ApmeStore, options raw: Options = Options()) -> [String: Any] {
        var options = raw
        options.limit = min(max(options.limit, 1), 400)
        options.minHubDegree = max(options.minHubDegree, 1)
        let page = store.listTaskPage(
            limit: options.limit,
            agentType: options.agentType,
            projectName: options.projectName,
            category: options.category)
        let runIds = Set(page.tasks.compactMap { $0["runId"] as? String })
        let graph = Builder()
        var toolEvents = 0
        var toolEventsWithPath = 0

        for task in page.tasks {
            guard let taskId = string(task["id"]),
                  let runId = string(task["runId"]),
                  let sessionId = string(task["sessionId"]),
                  let agentType = string(task["agentType"]) else { continue }
            let startedAt = integer(task["startedAt"])
            let runNode = graph.node(node(
                id: "run:\(runId)", kind: "run", label: String(runId.prefix(8)), ts: startedAt,
                meta: compact([
                    "project": task["projectName"], "agent": agentType, "model": task["modelId"],
                ])))
            let fallback = "Task \(integer(task["taskIndex"]) ?? 0)"
            let label = string(task["summary"]) ?? string(task["firstPrompt"]) ?? fallback
            let taskNode = graph.node(node(
                id: "task:\(taskId)", kind: "task", label: String(label.prefix(60)),
                ts: startedAt, score: number(task["overallScore"]),
                meta: compact([
                    "outcome": task["outcome"], "category": task["taskCategory"],
                    "boundary": task["boundarySignal"], "turns": integer(task["turnCount"]),
                    "answered": integer(task["answeredTurns"]), "tools": integer(task["toolCount"]),
                    "cost": number(task["costUsd"]),
                ])))
            graph.edge(runNode, taskNode, "contains")

            graph.edge(graph.node(node(id: "session:\(sessionId)", kind: "session", label: String(sessionId.prefix(12)))), runNode, "produced")
            graph.edge(graph.node(node(id: "agent:\(agentType)", kind: "agent", label: agentType)), runNode, "produced")
            if let project = string(task["projectName"]) {
                graph.edge(graph.node(node(id: "project:\(project)", kind: "project", label: project)), runNode, "produced")
            }
            if let model = string(task["modelId"]) {
                graph.edge(graph.node(node(id: "model:\(model)", kind: "model", label: model)), runNode, "produced")
            }
            if let parent = string(task["parentRunId"]), runIds.contains(parent) {
                graph.edge("run:\(parent)", runNode, "continues")
            }

            var delegated: Set<String> = []
            for event in store.listSampleEventRows(taskId) {
                let kind = string(event["kind"])
                let turnId = string(event["turn_id"])
                var anchor = taskNode
                if options.includeTurns, let turnId {
                    anchor = graph.node(node(
                        id: "turn:\(turnId)", kind: "turn",
                        label: "turn \(integer(event["turn_index"]) ?? 0)",
                        ts: integer(event["ts"]),
                        meta: ["index": integer(event["turn_index"]) ?? 0]))
                    graph.edge(taskNode, anchor, "contains")
                }

                if kind == "subagent" {
                    let payload = payloadObject(event["payload"])
                    guard let childId = string(payload["id"]),
                          let name = string(payload["name"]) else { continue }
                    let childNode = graph.node(node(
                        id: "subagent:\(sessionId):\(childId)", kind: "subagent", label: name,
                        ts: integer(event["ts"]),
                        meta: compact([
                            "phase": string(payload["phase"]) == "completed" ? "completed" : "started",
                            "durationMs": integer(payload["durationMs"]),
                            "summary": string(payload["summary"]),
                        ])))
                    let edgeKey = "\(anchor)|\(childNode)"
                    if delegated.insert(edgeKey).inserted {
                        graph.edge(anchor, childNode, "delegated")
                    }
                    continue
                }
                guard kind == "tool" else { continue }
                toolEvents += 1
                if let toolName = string(event["tool_name"]) {
                    graph.edge(anchor, graph.node(node(id: "tool:\(toolName)", kind: "tool", label: toolName)), "used")
                }
                if let path = filePath(fromPayload: event["payload"]) {
                    toolEventsWithPath += 1
                    if options.includeFiles {
                        let short = shorten(path: path, projectPath: string(task["projectPath"]))
                        graph.edge(anchor, graph.node(node(
                            id: "file:\(short)", kind: "file", label: short,
                            meta: ["full": path])), "touched")
                    }
                }
            }
        }

        graph.pruneHubs(minDegree: options.minHubDegree)
        let result = graph.finish()
        return [
            "nodes": result.nodes,
            "edges": result.edges,
            "stats": [
                "taskCount": page.tasks.count,
                "nodeCount": result.nodes.count,
                "edgeCount": result.edges.count,
                "truncatedTasks": max(0, page.total - page.tasks.count),
                "fileCoverage": ["toolEvents": toolEvents, "withPath": toolEventsWithPath],
            ],
        ]
    }

    private static func node(
        id: String, kind: String, label: String, ts: Int? = nil,
        score: Double? = nil, meta: [String: Any]? = nil
    ) -> [String: Any] {
        var out: [String: Any] = ["id": id, "kind": kind, "label": label]
        if let ts { out["ts"] = ts }
        if let score { out["score"] = score }
        if let meta, !meta.isEmpty { out["meta"] = meta }
        return out
    }

    private static func compact(_ values: [String: Any?]) -> [String: Any] {
        var out: [String: Any] = [:]
        for (key, value) in values {
            if let value, !(value is NSNull) { out[key] = value }
        }
        return out
    }

    private static func string(_ value: Any?) -> String? {
        guard let value = value as? String, !value.isEmpty else { return nil }
        return value
    }

    private static func integer(_ value: Any?) -> Int? {
        if let value = value as? Int { return value }
        return (value as? NSNumber)?.intValue
    }

    private static func number(_ value: Any?) -> Double? {
        if let value = value as? Double { return value }
        return (value as? NSNumber)?.doubleValue
    }

    private static func payloadObject(_ value: Any?) -> [String: Any] {
        guard let raw = value as? String,
              let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return object
    }

    private static func filePath(fromPayload value: Any?) -> String? {
        let payload = payloadObject(value)
        let source = payload["input"] as? [String: Any] ?? payload
        for key in ["file_path", "filePath", "path", "notebook_path", "file"] {
            if let path = string(source[key])?.trimmingCharacters(in: .whitespacesAndNewlines),
               !path.isEmpty { return path }
        }
        return nil
    }

    private static func shorten(path: String, projectPath: String?) -> String {
        if let projectPath {
            let root = projectPath.hasSuffix("/") ? projectPath : projectPath + "/"
            if path.hasPrefix(root) { return String(path.dropFirst(root.count)) }
        }
        let parts = path.split(separator: "/").map(String.init)
        return parts.count <= 3 ? parts.joined(separator: "/") : parts.suffix(3).joined(separator: "/")
    }
}
#endif
