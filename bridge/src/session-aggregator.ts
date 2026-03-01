import { listActive as listActiveSessions, type SessionEntry } from './session-registry.js';
import { probeGateway } from './gateway-probe.js';
import { debug } from './logger.js';
import type { AgentType } from './types.js';

export interface EnrichedSession {
  id: string;
  port: number;
  projectName: string;
  agentType?: AgentType;
  alive: boolean;
  state?: string;
}

/**
 * Enrich sibling sessions with state from their /health endpoint.
 * For the own session (matched by ownSessionId), uses ownState directly.
 */
export async function enrichSessionsWithState(
  sessions: SessionEntry[],
  ownSessionId: string,
  ownState: string,
): Promise<EnrichedSession[]> {
  return Promise.all(sessions.map(async (s) => {
    const base: EnrichedSession = {
      id: s.id,
      port: s.port,
      projectName: s.projectName,
      agentType: s.agentType as AgentType | undefined,
      alive: true,
    };
    if (s.id === ownSessionId) return { ...base, state: ownState };
    try {
      const res = await fetch(`http://127.0.0.1:${s.port}/health`, { signal: AbortSignal.timeout(2000) });
      const data = await res.json() as { state?: string };
      return { ...base, state: data.state };
    } catch {
      return base;
    }
  }));
}

/**
 * Build an enriched sessions list including virtual OpenClaw session if Gateway is detected.
 */
export async function buildEnrichedSessionsList(
  ownSessionId: string,
  ownState: string,
  gatewayAvailable: boolean,
): Promise<EnrichedSession[]> {
  const siblings = listActiveSessions();
  const enriched = await enrichSessionsWithState(siblings, ownSessionId, ownState);
  // Inject virtual OpenClaw session if Gateway is available but no OC bridge running
  if (gatewayAvailable && !enriched.some(s => s.agentType === 'openclaw')) {
    enriched.push({
      id: 'gateway-openclaw',
      port: 18789,
      projectName: 'OpenClaw',
      agentType: 'openclaw',
      alive: true,
      state: 'idle',
    });
  }
  return enriched;
}
