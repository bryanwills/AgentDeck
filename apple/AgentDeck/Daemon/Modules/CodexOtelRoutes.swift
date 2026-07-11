#if os(macOS)
// CodexOtelRoutes.swift — Register `/otel/v1/traces` so Codex's OTel
// HTTP exporter can push per-turn spans into the in-process daemon.
//
// JSON-only by design: the daemon parser keeps the raw body byte-for-byte,
// but Codex's protobuf OTel payload would require another decoder. We force
// `[otel.trace_exporter.otlp-http] protocol = "json"` in the user's
// config.toml; if Codex falls back to protobuf the route returns 415 and
// lifecycle hooks / notify still keep turn visibility.
//
// The handler delegates parsing to CodexTelemetryModule; this file only
// owns the HTTP plumbing so the parser stays unit-testable in isolation.

import Foundation

enum CodexOtelRoutes {
    /// Register the OTel trace endpoint. We hand the caller raw `Data`
    /// instead of `[String: Any]` so the body crosses the actor boundary
    /// as a Sendable type — JSON deserialization happens inside the
    /// caller's MainActor hop. (`[String: Any]` is not Sendable; passing
    /// it through a closure parameter would trip Swift 6's sending check
    /// even though Hook routes get away with the equivalent pattern when
    /// the dictionary is created locally inside the closure.)
    static func register(on http: HTTPServer, ingest: @escaping @Sendable (Data) -> Void) async {
        await http.post("/otel/v1/traces") { request in
            let ct = (request.headers["content-type"] ?? "").lowercased()
            // Diagnostic: dump every header that influences body framing /
            // encoding so we can tell whether Codex is sending chunked,
            // gzipped, or unexpectedly-typed payloads. This runs once per
            // POST; the volume is acceptable while we're chasing the
            // 65368-byte parse-fail.
            let cl = request.headers["content-length"] ?? "?"
            let te = request.headers["transfer-encoding"] ?? "-"
            let ce = request.headers["content-encoding"] ?? "-"
            // Throttled: Codex POSTs telemetry on a periodic timer, so logging
            // every request's headers floods swift-daemon.log. One line/min is
            // enough to confirm the exporter is still reaching us.
            DaemonLogger.shared.throttledDebug(
                "CodexOTel", key: "codexotel-post-headers",
                "POST headers ct=\(ct) cl=\(cl) te=\(te) ce=\(ce) bodyLen=\(request.body?.count ?? -1)",
                minInterval: 60
            )
            if !ct.contains("application/json") {
                return .json([
                    "error": "agentdeck-otel-json-only",
                    "hint": "set [otel.trace_exporter.otlp-http] protocol = \"json\" in ~/.codex/config.toml"
                ], status: 415)
            }
            guard let body = request.body, !body.isEmpty else {
                DaemonLogger.shared.debug("CodexOTel", "Empty body, dropping")
                return .json(["partialSuccess": [:]])
            }
            ingest(body)
            return .json(["partialSuccess": [:]])
        }
    }
}
#endif
