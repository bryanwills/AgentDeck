/**
 * session-utils.ts — Shared session ordering, numbering, and tier grouping.
 * Single source of truth used by: TUI renderer, Plugin, Android, Apple, MenuBarExtra.
 */

// ===== State Ranking =====

/**
 * Rank agent states by priority (lower = higher priority).
 * processing=0, awaiting=1, idle=2, disconnected=3, unknown=4.
 */
export function stateRank(state: string | undefined): number {
  switch (state) {
    case 'processing': return 0;
    case 'awaiting_permission':
    case 'awaiting_option':
    case 'awaiting_diff': return 1;
    case 'idle': return 2;
    case 'disconnected': return 3;
    default: return 4;
  }
}

// ===== Session Tier =====

export type SessionTier = 'attention' | 'active' | 'idle';

export function sessionTier(state: string | undefined): SessionTier {
  switch (state) {
    case 'awaiting_permission':
    case 'awaiting_option':
    case 'awaiting_diff':
      return 'attention';
    case 'processing':
      return 'active';
    default:
      return 'idle';
  }
}

// ===== Sorting =====

/**
 * Sort sessions by stateRank (processing first) then projectName alphabetically.
 * Returns a new array (never mutates input).
 */
export function sortSessions<T extends { state?: string; projectName?: string }>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    const rank = stateRank(a.state) - stateRank(b.state);
    if (rank !== 0) return rank;
    return (a.projectName || '').localeCompare(b.projectName || '');
  });
}

// ===== Display Name Assignment =====

export interface SessionDisplayInfo {
  /** Original session (unmodified) */
  session: { id: string; projectName: string; agentType?: string; state?: string; [key: string]: unknown };
  /** Display name with optional #N suffix */
  displayName: string;
  /** Session tier for UI grouping */
  tier: SessionTier;
}

/**
 * Assign display names with #N suffixes for duplicate (projectName, agentType) tuples.
 * Input is NOT mutated. Returns new display info objects.
 *
 * @param sessions - Already-sorted sessions array
 */
export function assignDisplayNames<T extends { id: string; projectName: string; agentType?: string; state?: string }>(
  sessions: T[],
): (SessionDisplayInfo & { session: T })[] {
  // Count occurrences of each (projectName, agentType) pair
  const counts = new Map<string, number>();
  for (const s of sessions) {
    const key = `${s.projectName}:${s.agentType || ''}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  // Assign sequential numbers
  const seq = new Map<string, number>();
  return sessions.map(s => {
    const key = `${s.projectName}:${s.agentType || ''}`;
    const n = (seq.get(key) || 0) + 1;
    seq.set(key, n);
    const needsSuffix = (counts.get(key) || 1) > 1;
    const displayName = needsSuffix ? `${s.projectName} #${n}` : s.projectName;
    return {
      session: s,
      displayName,
      tier: sessionTier(s.state),
    };
  });
}
