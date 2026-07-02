/**
 * Fallback task-row emitter for APME-disabled daemons.
 *
 * task_start / task_end timeline rows are normally minted by the APME
 * collector (bridge/src/apme/index.ts wires them to emitTimeline). When
 * better-sqlite3 can't load (`initApme()` → null — Node ABI mismatch, missing
 * build tools on a fresh install), the whole task hierarchy vanishes and the
 * device timeline degrades to a flat chat/tool stream with no work-unit
 * structure at all.
 *
 * This tracker mirrors ONLY the collector's boundary state machine — open a
 * task on the first user prompt, close it on `/clear` or session end — and
 * emits the same timeline rows with synthetic taskIds. No storage, no eval:
 * task_end rows never receive a judge verdict (the dashboard badge settles to
 * "unscored"), and taskIndex resets when the daemon restarts. Good enough to
 * keep the timeline structurally intact until APME is repaired.
 */

import { randomUUID } from 'crypto';
import type { TimelineEntry } from '@agentdeck/shared';

interface ActiveFallbackTask {
  taskId: string;
  startedAt: number;
  index: number;
}

export class FallbackTaskTimeline {
  /** sessionId → in-flight task. */
  private readonly active = new Map<string, ActiveFallbackTask>();
  /** sessionId → next task index (mirrors the collector's per-run counter). */
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly emit: (entry: TimelineEntry) => void,
    private readonly meta: { agentType?: string } = {},
  ) {}

  /**
   * Feed a hook event. Accepts both the PascalCase hook names the session
   * bridge forwards (`UserPromptSubmit`) and the snake_case names the daemon
   * hook endpoint maps to (`user_prompt_submit`).
   */
  ingestHook(sessionId: string, event: string, data: Record<string, unknown>): void {
    const e = event.toLowerCase().replace(/_/g, '');
    if (e === 'userpromptsubmit') {
      const prompt = readPrompt(data);
      if (prompt && /^\s*\/clear\s*$/i.test(prompt)) {
        this.close(sessionId, 'clear');
        return;
      }
      this.openIfNone(sessionId);
      return;
    }
    if (e === 'sessionend') {
      this.close(sessionId, 'session_end');
    }
  }

  private openIfNone(sessionId: string): void {
    if (this.active.has(sessionId)) return;
    const index = this.counts.get(sessionId) ?? 0;
    this.counts.set(sessionId, index + 1);
    const task: ActiveFallbackTask = { taskId: randomUUID(), startedAt: Date.now(), index };
    this.active.set(sessionId, task);
    this.emit({
      ts: task.startedAt,
      type: 'task_start',
      raw: `Task ${index + 1}`,
      sessionId,
      taskId: task.taskId,
      startedAt: task.startedAt,
      ...(this.meta.agentType ? { agentType: this.meta.agentType } : {}),
    });
  }

  private close(sessionId: string, boundarySignal: 'clear' | 'session_end'): void {
    const task = this.active.get(sessionId);
    if (!task) return;
    this.active.delete(sessionId);
    const endedAt = Date.now();
    const durationSec = Math.max(0, Math.round((endedAt - task.startedAt) / 1000));
    const signalLabel = boundarySignal === 'clear' ? '/clear' : 'Session end';
    this.emit({
      ts: endedAt,
      type: 'task_end',
      raw: `${signalLabel} · ${durationSec}s`,
      sessionId,
      taskId: task.taskId,
      boundarySignal,
      startedAt: task.startedAt,
      endedAt,
      ...(this.meta.agentType ? { agentType: this.meta.agentType } : {}),
    });
  }
}

/** Claude Code sends { message: { content } } via spans, raw hooks send { prompt }. */
function readPrompt(data: Record<string, unknown>): string | null {
  if (typeof data.prompt === 'string') return data.prompt;
  const message = data.message;
  if (message && typeof message === 'object') {
    const content = (message as Record<string, unknown>).content;
    if (typeof content === 'string') return content;
  }
  return null;
}
