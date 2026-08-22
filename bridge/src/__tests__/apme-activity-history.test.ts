import { describe, expect, it } from 'vitest';
import {
  activityOriginKey,
  localActivityRows,
  makeActivitySnapshot,
  mergeActivityRows,
  type ApmeActivityRow,
} from '../apme/activity-history.js';

function row(patch: Partial<ApmeActivityRow> = {}): ApmeActivityRow {
  return {
    originKey: 'activity:v1:a',
    agentType: 'codex-cli',
    sessionId: 'thread-1',
    taskIndex: 0,
    projectName: 'AgentDeck',
    modelId: null,
    task: 'Fix the parser',
    startedAt: 1_000,
    endedAt: 11_000,
    durationMs: 10_000,
    turnCount: 1,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    overallScore: null,
    provenance: ['node'],
    ...patch,
  };
}

describe('APME unified activity history', () => {
  it('uses the same deterministic identity contract as the Swift mirror', () => {
    expect(activityOriginKey({
      agentType: 'codex-cli', sessionId: 'codex:thread-1', taskIndex: 3,
      firstPrompt: '  Fix   the parser  ',
    })).toBe('activity:v1:da0d9af3fd0f247f1befac63');
  });

  it('collapses exact duplicates and keeps the richer fields without summing them', () => {
    const merged = mergeActivityRows([
      row(),
      row({
        provenance: ['swift'], modelId: 'gpt-5', endedAt: 12_000,
        durationMs: 11_000, inputTokens: 100, overallScore: 0.8,
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      modelId: 'gpt-5', endedAt: 12_000, durationMs: 11_000,
      inputTokens: 100, overallScore: 0.8, provenance: ['node', 'swift'],
    });
  });

  it('stitches a handover fragment only when native session/task and time agree', () => {
    const near = row({ originKey: 'activity:v1:b', startedAt: 12_000, endedAt: 20_000, provenance: ['swift'] });
    const hoursLater = row({ startedAt: 8 * 60 * 60 * 1000, endedAt: null, provenance: ['swift'] });
    expect(mergeActivityRows([row(), near])).toHaveLength(1);
    expect(mergeActivityRows([row(), hoursLater])).toHaveLength(2);
  });

  it('builds one glanceable per-agent total after dedup', () => {
    const snapshot = makeActivitySnapshot([
      row(),
      row({ originKey: 'activity:v1:2', agentType: 'claude-code', sessionId: 's2', durationMs: 4_000 }),
    ]);
    expect(snapshot.agents).toEqual([
      expect.objectContaining({ agentType: 'codex-cli', taskCount: 1, durationMs: 10_000 }),
      expect.objectContaining({ agentType: 'claude-code', taskCount: 1, durationMs: 4_000 }),
    ]);
  });

  it('reports agent work time instead of user think time between turns', () => {
    const store = {
      listTaskPage: () => ({ total: 1, tasks: [{
        id: 'task-1', agentType: 'codex-cli', sessionId: 'thread-1',
        taskIndex: 0, projectName: 'AgentDeck', modelId: null,
        firstPrompt: 'Fix it', summary: null, startedAt: 1_000,
        endedAt: 100_000, turnCount: 2, inputTokens: null,
        outputTokens: null, costUsd: null, overallScore: null,
        compositeScore: null,
      }] }),
      listTurnsForTask: () => [
        { started_at: 1_000, ended_at: 3_000 },
        { started_at: 90_000, ended_at: 95_000 },
      ],
    } as any;

    expect(localActivityRows(store)[0].durationMs).toBe(7_000);
  });
});
