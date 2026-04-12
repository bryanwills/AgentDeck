/**
 * APME Recommendation Engine — Phase 4.
 *
 * Given a task context and the user's available models/subscriptions, return a
 * ranked list of model candidates with expected score, expected cost, and
 * confidence. v1 uses the v_model_scorecard view; v2 (stretch) layers in
 * task-similarity via local embeddings.
 */

import type { AgentType } from '@agentdeck/shared';
import type { ApmeStore } from './store.js';

export interface RecommendInput {
  taskKind?: string;
  budgetUsd?: number;
  latencyBudgetMs?: number;
  preferLocal?: boolean;
  /** Models the user has access to — comes from settings.json.apme.subscriptions. */
  availableModels?: string[];
}

export interface RecommendCandidate {
  modelId: string;
  agentType: AgentType;
  expectedScore: number;
  expectedCostUsd: number;
  confidence: number;
  rationale: string;
}

export class ApmeRecommender {
  constructor(private readonly store: ApmeStore) {}

  recommend(input: RecommendInput): RecommendCandidate[] {
    if (!this.store.enabled) return [];
    const rows = this.store.scorecard();
    const filtered = input.availableModels
      ? rows.filter((r) => input.availableModels!.includes(r.modelId))
      : rows;
    return filtered
      .filter((r) => r.runs >= 3 && (r.avgOverall ?? 0) > 0)
      .sort((a, b) => {
        // Prefer cost-per-quality if budget is tight, otherwise raw quality.
        if (input.budgetUsd !== undefined && input.budgetUsd < 5) {
          return (a.costPerQuality ?? Infinity) - (b.costPerQuality ?? Infinity);
        }
        return (b.avgOverall ?? 0) - (a.avgOverall ?? 0);
      })
      .slice(0, 3)
      .map((r) => ({
        modelId: r.modelId,
        agentType: r.agentType as AgentType,
        expectedScore: r.avgOverall ?? 0,
        expectedCostUsd: (r.totalCost ?? 0) / Math.max(r.runs, 1),
        confidence: Math.min(1, r.runs / 20),
        rationale: `${r.runs} runs, avg ${((r.avgOverall ?? 0) * 100).toFixed(0)}%${
          r.avgTestsPass != null ? `, tests ${((r.avgTestsPass) * 100).toFixed(0)}%` : ''
        }`,
      }));
  }
}
