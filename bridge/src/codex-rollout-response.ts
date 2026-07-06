/**
 * Extract a Codex turn's final response text from its rollout JSONL.
 *
 * Why this exists: observed (direct-run) Codex sessions reach the daemon
 * only through codex_* lifecycle hooks, and `codex_stop`'s stdin payload
 * does not reliably carry the assistant text (the Swift daemon probes
 * `last_assistant_message`/`response`/`output`/`result` and usually finds
 * nothing). The rollout Codex writes under `~/.codex/sessions/` DOES hold
 * it: `event_msg` records of type `agent_message` (`payload.message`) and,
 * at turn end, `task_complete` (`payload.last_agent_message`). This is the
 * Codex counterpart of `lastAssistantTextFromTranscript` for Claude —
 * hooks stay the boundary signal, the agent's own on-disk log supplies the
 * body, and nothing parses terminal output.
 *
 * Self-contained and read-only on purpose (mirrors
 * session-transcript-timeline.ts): never throws, returns '' when nothing
 * is found. Locating scans recent `~/.codex/sessions/<y>/<m>/<d>/` dirs
 * newest-first for `rollout-*-<sessionId>.jsonl` — the filename embeds the
 * session uuid, and scanning across day dirs (bounded) covers turns that
 * roll past midnight (memory: cross-day rollout selection).
 */

import { readdirSync, readFileSync, openSync, readSync, closeSync, fstatSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { debug } from './logger.js';

/** Max day directories to inspect, newest first. */
const MAX_DAY_DIRS = 30;
/** Tail window — final agent_message + task_complete land at the end. */
const TAIL_BYTES = 128 * 1024;

function numericDesc(names: string[]): string[] {
  return names
    .filter((n) => /^\d+$/.test(n))
    .sort((a, b) => Number(b) - Number(a));
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/** Locate `rollout-*-<sessionId>.jsonl` under the newest day dirs. */
export function locateCodexRollout(sessionId: string, sessionsRoot?: string): string | null {
  if (!sessionId || !/^[0-9a-f-]{8,}$/i.test(sessionId)) return null;
  const root = sessionsRoot ?? join(homedir(), '.codex', 'sessions');
  const suffix = `-${sessionId}.jsonl`;
  let dayDirsChecked = 0;
  for (const year of numericDesc(safeReaddir(root))) {
    for (const month of numericDesc(safeReaddir(join(root, year)))) {
      for (const day of numericDesc(safeReaddir(join(root, year, month)))) {
        if (++dayDirsChecked > MAX_DAY_DIRS) return null;
        const dir = join(root, year, month, day);
        for (const name of safeReaddir(dir)) {
          if (name.startsWith('rollout-') && name.endsWith(suffix)) {
            return join(dir, name);
          }
        }
      }
    }
  }
  return null;
}

function readTail(path: string, maxBytes: number): string {
  try {
    const fd = openSync(path, 'r');
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(size, maxBytes);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      return buf.toString('utf-8');
    } finally {
      closeSync(fd);
    }
  } catch {
    try {
      return readFileSync(path, 'utf-8').slice(-maxBytes);
    } catch {
      return '';
    }
  }
}

/**
 * Parse the rollout tail for the turn's final response, newest record
 * first. `task_complete.last_agent_message` wins (authoritative turn
 * close); otherwise the last `agent_message` body — Codex emits
 * mid-turn `commentary` messages too, and the final one is the reply.
 */
export function lastAgentMessageFromCodexRollout(sessionId: string, sessionsRoot?: string): string {
  const path = locateCodexRollout(sessionId, sessionsRoot);
  if (!path) return '';
  const lines = readTail(path, TAIL_BYTES).split('\n');
  let lastAgentMessage = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // torn first line of the tail window
    }
    if (record.type !== 'event_msg') continue;
    const payload = record.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') continue;
    if (payload.type === 'task_complete' && typeof payload.last_agent_message === 'string'
        && payload.last_agent_message.trim()) {
      return payload.last_agent_message.trim();
    }
    if (!lastAgentMessage && payload.type === 'agent_message'
        && typeof payload.message === 'string' && payload.message.trim()) {
      lastAgentMessage = payload.message.trim();
      // Keep scanning upward only for a task_complete that might supersede;
      // but task_complete always FOLLOWS agent_message in the log, so if we
      // reached an agent_message first (scanning backwards) there is no
      // newer task_complete — return immediately.
      break;
    }
  }
  if (!lastAgentMessage) debug('codex-rollout', `no agent_message in tail of ${path}`);
  return lastAgentMessage;
}
