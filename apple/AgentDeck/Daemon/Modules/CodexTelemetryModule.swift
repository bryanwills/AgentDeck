#if os(macOS)
// CodexTelemetryModule.swift — Translate OTLP/HTTP JSON spans emitted by
// Codex into a small ordered set of session-state events the daemon can
// drive its sessions list with.
//
// We cannot pin to an exact span schema yet — Codex's OTel keys are not
// formally documented as a stable API. We accept a few naming variants
// (dotted vs underscored, `codex.thread_id` vs `thread.id`, etc.) and
// silently drop anything we don't recognise. The four events we care
// about cover turn boundaries and per-tool progress, which is enough to
// drive Dashboard creature state without trying to render every internal
// model call.

import Foundation

/// Distilled span events. Equatable for cheap unit-test assertions and
/// Sendable so the parser can be called from non-isolated contexts.
enum CodexSpanEvent: Sendable, Equatable {
    case turnStart(threadId: String, turnId: String, cwd: String?)
    case toolCall(threadId: String, turnId: String, tool: String)
    case toolResult(threadId: String, turnId: String)
    case turnEnd(threadId: String, turnId: String)
}

enum CodexTelemetryModule {

    /// Parse an OTLP/HTTP `ExportTraceServiceRequest` into the ordered
    /// events. Spans are visited in the order they appear in the body; we
    /// don't sort by timestamp because OTel exporters batch consecutive
    /// spans and Codex emits them in roughly chronological order anyway.
    static func parse(_ json: [String: Any]) -> [CodexSpanEvent] {
        var out: [CodexSpanEvent] = []
        let resourceSpans = (json["resourceSpans"] as? [[String: Any]]) ?? []
        for r in resourceSpans {
            // Resource-level attrs (set once for the whole batch — typically
            // service.name + identifying ids) can carry thread id when a
            // span itself doesn't repeat it. Span attrs win on collision.
            let resourceAttrs = flattenAttrs(((r["resource"] as? [String: Any])?["attributes"] as? [[String: Any]]) ?? [])
            let scopeSpans = (r["scopeSpans"] as? [[String: Any]]) ?? []
            for ss in scopeSpans {
                let spans = (ss["spans"] as? [[String: Any]]) ?? []
                for span in spans {
                    if let event = classify(span: span, resourceAttrs: resourceAttrs) {
                        out.append(event)
                    }
                }
            }
        }
        return out
    }

    /// Lightweight diagnostic for unknown future schemas. Keeps live logs
    /// useful without dumping entire OTLP payloads.
    static func spanNameSummary(_ json: [String: Any], limit: Int = 12) -> String {
        var names: [String] = []
        let resourceSpans = (json["resourceSpans"] as? [[String: Any]]) ?? []
        for r in resourceSpans {
            let scopeSpans = (r["scopeSpans"] as? [[String: Any]]) ?? []
            for ss in scopeSpans {
                let spans = (ss["spans"] as? [[String: Any]]) ?? []
                for span in spans {
                    if let name = span["name"] as? String, !name.isEmpty {
                        names.append(name)
                    }
                }
            }
        }
        return Array(names.prefix(limit)).joined(separator: ",")
    }

    // MARK: - Internals

    private static func classify(span: [String: Any], resourceAttrs: [String: Any]) -> CodexSpanEvent? {
        guard let rawName = span["name"] as? String else { return nil }
        let attrs = resourceAttrs.merging(
            flattenAttrs(span["attributes"] as? [[String: Any]] ?? []),
            uniquingKeysWith: { _, new in new }
        )

        guard let threadId = stringAttr(attrs, keys: ["codex.thread_id", "thread.id", "thread_id", "session_id"]),
              !threadId.isEmpty else {
            return nil
        }
        let turnId = stringAttr(attrs, keys: ["codex.turn_id", "turn.id", "turn_id"]) ?? ""

        // Normalize underscore variants (`codex.tool_call`) → dotted form
        // (`codex.tool.call`) so we don't have to enumerate every spelling.
        let normalized = rawName.replacingOccurrences(of: "_", with: ".")

        switch normalized {
        case "codex.turn", "codex.turn.start", "op.dispatch.user.input.with.turn.context":
            let cwd = stringAttr(attrs, keys: ["cwd", "codex.cwd"])
            return .turnStart(threadId: threadId, turnId: turnId, cwd: cwd)
        case "codex.tool.call", "tool.call", "turn.tool.call":
            let tool = stringAttr(attrs, keys: ["tool.name", "tool", "codex.tool", "tool"]) ?? "?"
            return .toolCall(threadId: threadId, turnId: turnId, tool: tool)
        case "codex.tool.result", "tool.result", "tool.call.duration.ms":
            return .toolResult(threadId: threadId, turnId: turnId)
        case "codex.turn.end", "session.task.turn":
            return .turnEnd(threadId: threadId, turnId: turnId)
        default:
            return nil
        }
    }

    /// First non-empty string attribute among `keys`, or nil.
    private static func stringAttr(_ attrs: [String: Any], keys: [String]) -> String? {
        for key in keys {
            if let s = attrs[key] as? String, !s.isEmpty {
                return s
            }
            if let n = attrs[key] as? Int {
                return String(n)
            }
        }
        return nil
    }

    /// OTLP attributes are arrays of `{ key, value: { <typeKey>Value } }`
    /// where `<typeKey>` is one of string / int / bool / double / bytes.
    /// We stash whichever scalar variant is present so callers can dot-key
    /// into `[String: Any]` without re-parsing the OTLP envelope.
    private static func flattenAttrs(_ raw: [[String: Any]]) -> [String: Any] {
        var out: [String: Any] = [:]
        for kv in raw {
            guard let key = kv["key"] as? String,
                  let valueWrap = kv["value"] as? [String: Any] else { continue }
            if let s = valueWrap["stringValue"] as? String {
                out[key] = s
                continue
            }
            // OTLP encodes int64 as either a number or a stringified number
            // depending on the SDK version — accept both so a future Codex
            // build switching encoders doesn't silently lose attributes.
            if let raw = valueWrap["intValue"] {
                if let n = raw as? Int { out[key] = n }
                else if let s = raw as? String, let n = Int(s) { out[key] = n }
                continue
            }
            if let b = valueWrap["boolValue"] as? Bool { out[key] = b; continue }
            if let d = valueWrap["doubleValue"] as? Double { out[key] = d; continue }
        }
        return out
    }
}
#endif
