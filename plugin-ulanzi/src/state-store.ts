/**
 * Caches the latest daemon broadcasts and produces the merged `stateEvt` the
 * shared layout engine (`buildLayoutMap`) consumes. Focused-session selection
 * follows the AgentDeck rule: focusedSessionId ?? sessionId.
 */
import type { BridgeEvent, SessionInfo } from '@agentdeck/shared';

export class StateStore {
  /** Last raw state_update event (carries focused session's project/model/etc). */
  private lastState: Record<string, unknown> = { state: 'IDLE' };
  /** Full focused snapshots, isolated by session identity. */
  private sessionStates = new Map<string, Record<string, unknown>>();
  private sessions: SessionInfo[] = [];
  private usage: Record<string, unknown> = {};
  /** Daemon link state — false until connected, false again on disconnect. */
  private connected = false;

  /** Reflect daemon connect/disconnect so the deck shows OFFLINE when down. */
  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  /** Start a focus handshake from the selected sessions_list row, not stale detail. */
  prepareFocus(sessionId: string): void {
    this.sessionStates.delete(sessionId);
  }

  private eventSessionId(e: Record<string, unknown>): string | undefined {
    const focused = typeof e.focusedSessionId === 'string' ? e.focusedSessionId : '';
    if (focused) return focused;
    return typeof e.sessionId === 'string' && e.sessionId ? e.sessionId : undefined;
  }

  private sessionBase(sessionId: string): Record<string, unknown> | undefined {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return undefined;
    return {
      state: session.state ?? (session.alive ? 'IDLE' : 'DISCONNECTED'),
      sessionId,
      focusedSessionId: '',
      projectName: session.projectName,
      agentType: session.agentType,
      modelName: session.modelName,
      currentTool: session.currentTool,
      question: session.question,
      promptType: session.promptType,
      options: session.options ?? [],
    };
  }

  /** Apply a daemon event. Returns true if the visible state likely changed. */
  apply(ev: BridgeEvent): boolean {
    const e = ev as unknown as Record<string, unknown>;
    switch (ev.type) {
      case 'sessions_list':
        this.sessions = (e.sessions as SessionInfo[]) ?? [];
        for (const id of this.sessionStates.keys()) {
          if (!this.sessions.some((session) => session.id === id)) this.sessionStates.delete(id);
        }
        return true;
      case 'state_update': {
        this.lastState = e;
        const sessionId = this.eventSessionId(e);
        if (sessionId) {
          // Replacement, not merge: absent fields must not survive from a
          // previous agent or an earlier state of this session.
          this.sessionStates.set(sessionId, { ...e, sessionId });
        }
        return true;
      }
      case 'prompt_options': {
        const sessionId = this.eventSessionId(e);
        // Source-less legacy events are display-only noise on a multi-session
        // daemon and must never become actionable D200H keys.
        if (!sessionId) return false;
        const base = this.sessionStates.get(sessionId) ?? this.sessionBase(sessionId) ?? { sessionId };
        this.sessionStates.set(sessionId, {
          ...base,
          options: e.options,
          promptType: e.promptType,
          question: e.question,
        });
        return true;
      }
      case 'usage_update':
        this.usage = e;
        return true;
      default:
        return false;
    }
  }

  /** Merged event for the shared layout engine. `allSessions` is the live list. */
  toLayoutInput(selectedSessionId?: string): Record<string, unknown> {
    // Daemon down → force DISCONNECTED so the deck shows OFFLINE, not a stale list.
    if (!this.connected) {
      return { state: 'DISCONNECTED', allSessions: [] };
    }
    let totalTokens = this.usage.totalTokens as number | undefined;
    if (totalTokens == null && (this.usage.inputTokens != null || this.usage.outputTokens != null)) {
      totalTokens = ((this.usage.inputTokens as number) ?? 0) + ((this.usage.outputTokens as number) ?? 0);
    }
    totalTokens ??= (this.lastState.totalTokens as number) ?? 0;
    // Subscription quota rides usage_update. Distinguish "0% used" from "no data"
    // so the deck draws a "—" instead of a confident 0% when the hub has no
    // OAuth source or the cache went stale. The numeric is still coerced to 0
    // (the gauge bar needs a number); display is gated by usageKnown.
    const stale = this.usage.usageStale === true;
    const usageKnown = !stale && (this.usage.fiveHourPercent != null || this.usage.sevenDayPercent != null);
    // In detail mode, use only the selected session's row/snapshot. Never fall
    // back to lastState, which may belong to OpenClaw or another PTY.
    const selected = selectedSessionId
      ? {
          ...(this.sessionBase(selectedSessionId) ?? {}),
          ...(this.sessionStates.get(selectedSessionId) ?? {}),
        }
      : this.lastState;
    return {
      ...selected,
      allSessions: this.sessions,
      totalTokens,
      totalCost: (this.usage.totalCost as number) ?? (selected.totalCost as number) ?? 0,
      fiveHourPercent: (this.usage.fiveHourPercent as number) ?? (selected.fiveHourPercent as number) ?? 0,
      sevenDayPercent: (this.usage.sevenDayPercent as number) ?? (selected.sevenDayPercent as number) ?? 0,
      fiveHourResetsAt: this.usage.fiveHourResetsAt as string | undefined,
      sevenDayResetsAt: this.usage.sevenDayResetsAt as string | undefined,
      // Codex (ChatGPT) rolling-window quota rides the same usage_update event.
      // Pass it straight through so the layout engine can draw CX 5H/7D tiles
      // alongside Claude's, mirroring how fiveHourPercent is surfaced.
      codexRateLimits: this.usage.codexRateLimits,
      usageKnown,
    };
  }
}
