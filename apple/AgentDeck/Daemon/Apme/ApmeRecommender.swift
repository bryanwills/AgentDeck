#if os(macOS)
// ApmeRecommender.swift — Model recommendation engine.
//
// Swift port of bridge/src/apme/recommend.ts. Reads the v_model_scorecard
// view (pre-aggregated in SQLite) and returns a ranked list of model
// candidates based on historical performance + cost.
//
// Ranking:
//   - With tight budget (budgetUsd < 5): sort by cost_per_quality ascending
//   - Otherwise: sort by avg_overall descending
//
// Confidence is proportional to runs/20, clamped to [0, 1] — a model with
// 20+ runs gets full confidence, fewer means "we're guessing".
//
// Phase 2 parity with TS: same filter/sort/slice logic, same output shape.
// Phase 3 (stretch, not in this commit) would layer in local embedding-
// based task similarity so the recommendation is context-aware.

import Foundation

struct ApmeRecommendInput {
    var taskKind: String?
    var budgetUsd: Double?
    var latencyBudgetMs: Double?
    var preferLocal: Bool = false
    /// Models the user actually has access to. Filter applied BEFORE
    /// ranking so we don't recommend subscriptions they can't use.
    var availableModels: [String]?
}

struct ApmeRecommendCandidate {
    let modelId: String
    let agentType: String
    let provider: String?
    let expectedScore: Double
    let expectedCostUsd: Double?
    let confidence: Double
    let rationale: String
}

enum ApmeRecommender {
    /// A point on the (quality, cost) plane for Pareto analysis.
    private struct ParetoPoint {
        let agentType: String
        let modelId: String
        let provider: String?
        let quality: Double
        let costPerSample: Double?
        let avgLatencyMs: Double?
        let samples: Int
    }

    /// Frontier = non-dominated points (no other point is both higher quality
    /// AND lower-or-equal cost). Mirrors bridge/src/apme/pareto.ts.
    private static func computeParetoFrontier(_ rows: [[String: Any]], minSamples: Int = 3) -> [ParetoPoint] {
        let points: [ParetoPoint] = rows.compactMap { r in
            let samples = (r["samples"] as? Int) ?? 0
            let quality = (r["avg_quality"] as? Double) ?? 0
            guard samples >= minSamples, quality > 0 else { return nil }
            let known = (r["cost_known"] as? Int) == 1
            let total = r["total_cost"] as? Double
            return ParetoPoint(
                agentType: (r["agent_type"] as? String) ?? "unknown",
                modelId: (r["model_id"] as? String) ?? "unknown",
                provider: r["provider"] as? String,
                quality: quality,
                costPerSample: known && samples > 0 ? total.map { $0 / Double(samples) } : nil,
                avgLatencyMs: r["avg_latency_ms"] as? Double,
                samples: samples)
        }
        func dominates(_ b: ParetoPoint, _ a: ParetoPoint) -> Bool {
            let bc = b.costPerSample ?? .greatestFiniteMagnitude
            let ac = a.costPerSample ?? .greatestFiniteMagnitude
            let ge = b.quality >= a.quality && bc <= ac
            let gt = b.quality > a.quality || bc < ac
            return ge && gt
        }
        var frontier = points.filter { a in !points.contains { b in b.modelId != a.modelId && dominates(b, a) } }
        frontier.sort {
            let ac = $0.costPerSample ?? .greatestFiniteMagnitude
            let bc = $1.costPerSample ?? .greatestFiniteMagnitude
            return ac < bc || (ac == bc && $0.quality > $1.quality)
        }
        return frontier
    }

    /// Return up to 3 ranked candidates. Prefers the sample-granularity Pareto
    /// frontier (the quality/cost tradeoff curve); falls back to the run-level
    /// scorecard when no sample data has accumulated yet.
    static func recommend(store: ApmeStore, input: ApmeRecommendInput = ApmeRecommendInput()) -> [ApmeRecommendCandidate] {
        guard store.isOpen else { return [] }

        // ── Sample-granularity Pareto path ──
        let sampleRows = store.sampleScorecard()
        let scoped = input.taskKind != nil ? sampleRows.filter { ($0["task_category"] as? String) == input.taskKind } : sampleRows
        var frontier = computeParetoFrontier(scoped)
        if frontier.isEmpty { frontier = computeParetoFrontier(sampleRows) }

        if !frontier.isEmpty {
            var candidates = frontier
            if let available = input.availableModels, !available.isEmpty {
                candidates = candidates.filter { available.contains($0.modelId) }
            }
            if let budget = input.budgetUsd {
                candidates = candidates.filter { $0.costPerSample != nil && $0.costPerSample! <= budget }
            }
            if let latency = input.latencyBudgetMs {
                candidates = candidates.filter { $0.avgLatencyMs == nil || $0.avgLatencyMs! <= latency }
            }
            candidates.sort { a, b in
                if input.preferLocal || (input.budgetUsd != nil && input.budgetUsd! < 5) {
                    let ac = a.costPerSample ?? .greatestFiniteMagnitude
                    let bc = b.costPerSample ?? .greatestFiniteMagnitude
                    return ac < bc || (ac == bc && a.quality > b.quality)
                }
                let ac = a.costPerSample ?? .greatestFiniteMagnitude
                let bc = b.costPerSample ?? .greatestFiniteMagnitude
                return a.quality > b.quality || (a.quality == b.quality && ac < bc)
            }
            if !candidates.isEmpty {
                return candidates.prefix(3).map { (p: ParetoPoint) -> ApmeRecommendCandidate in
                    let pct: Int = Int((p.quality * 100).rounded())
                    let costLabel = p.costPerSample.map { "$\(String(format: "%.4f", $0))/sample" } ?? "cost unpriced"
                    var rationale: String = "\(p.samples) samples, avg \(pct)%, \(costLabel)"
                    if let l = p.avgLatencyMs {
                        let ms: Int = Int(l.rounded())
                        rationale += ", \(ms)ms"
                    }
                    rationale += " — on the cost/quality frontier"
                    let conf: Double = min(1.0, Double(p.samples) / 20.0)
                    return ApmeRecommendCandidate(
                        modelId: p.modelId, agentType: p.agentType,
                        provider: p.provider,
                        expectedScore: p.quality, expectedCostUsd: p.costPerSample,
                        confidence: conf, rationale: rationale)
                }
            }
        }

        // ── Run-level fallback (legacy data with no sample composite scores) ──
        // Raw scorecard dicts — matches v_model_scorecard columns.
        let rows = store.scorecard()

        // Filter by availableModels if user provided a subscription list.
        var filtered: [[String: Any]] = {
            guard let available = input.availableModels, !available.isEmpty else {
                return rows
            }
            return rows.filter { row in
                guard let modelId = row["model_id"] as? String else { return false }
                return available.contains(modelId)
            }
        }()
        if input.budgetUsd != nil {
            filtered = filtered.filter { ($0["cost_known"] as? Int) == 1 }
        }

        // Eligibility: at least 3 runs AND non-zero avg_overall.
        let eligible = filtered.filter { row in
            let runs = (row["runs"] as? Int) ?? 0
            let avgOverall = (row["avg_overall"] as? Double) ?? 0
            return runs >= 3 && avgOverall > 0
        }

        // Sort by budget preference.
        let sorted = eligible.sorted { a, b in
            if let budget = input.budgetUsd, budget < 5 {
                // Tight budget: lower cost-per-quality wins.
                let aCost = (a["cost_per_quality"] as? Double) ?? .greatestFiniteMagnitude
                let bCost = (b["cost_per_quality"] as? Double) ?? .greatestFiniteMagnitude
                return aCost < bCost
            }
            let aScore = (a["avg_overall"] as? Double) ?? 0
            let bScore = (b["avg_overall"] as? Double) ?? 0
            return aScore > bScore
        }

        // Top 3 → map to candidates.
        return sorted.prefix(3).map { row -> ApmeRecommendCandidate in
            let modelId = (row["model_id"] as? String) ?? "unknown"
            let agentType = (row["agent_type"] as? String) ?? "unknown"
            let runs = (row["runs"] as? Int) ?? 0
            let avgOverall = (row["avg_overall"] as? Double) ?? 0
            let totalCost = row["total_cost"] as? Double
            let costKnown = (row["cost_known"] as? Int) == 1
            let avgTests = row["avg_tests_pass"] as? Double

            var rationale = "\(runs) runs, avg \(Int((avgOverall * 100).rounded()))%"
            if let t = avgTests {
                rationale += ", tests \(Int((t * 100).rounded()))%"
            }

            return ApmeRecommendCandidate(
                modelId: modelId,
                agentType: agentType,
                provider: row["provider"] as? String,
                expectedScore: avgOverall,
                expectedCostUsd: costKnown ? totalCost.map { $0 / Double(max(runs, 1)) } : nil,
                confidence: min(1.0, Double(runs) / 20.0),
                rationale: rationale
            )
        }
    }
}
#endif
