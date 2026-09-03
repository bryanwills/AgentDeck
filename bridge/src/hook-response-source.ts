/**
 * Where a Stop hook's reply text comes from, decided per agent.
 *
 * Inline text wins wherever it exists — it is the hook's own statement of
 * what the agent said. Otherwise each agent's OWN on-disk record is read by
 * ITS reader: Claude's transcript JSONL by the Claude reader, Codex's rollout
 * by the Codex reader. The old rule was "transcript_path ⇒ Claude reader",
 * and a Codex hook carries a transcript_path too — its rollout — so every
 * Codex turn read '' while `last_assistant_message` sat in the same payload.
 * Measured 2026-09-03 over one week: 3 of 128 codex stop-turns held a
 * response; the task judge scored the other tasks against silence.
 *
 * Pure so the decision table is testable without a daemon: the readers are
 * injected, and only the one the agent owns is ever called.
 */

import type { CodexTurnOutcome } from './codex-rollout-response.js';

export interface StopResponseReaders {
  /** Claude transcript JSONL → last assistant text ('' when none). */
  readClaudeTranscript: (transcriptPath: string) => string;
  /** Codex rollout at a known path. */
  readCodexRolloutPath: (rolloutPath: string) => CodexTurnOutcome;
  /** Codex rollout located by session id (when the hook carried no path). */
  readCodexRolloutById: (sessionId: string) => CodexTurnOutcome;
}

export interface StopResponseInput {
  agentType: string;
  sessionId: string;
  /** Payload fields, in preference order, already reduced to the first
   *  non-empty string (`last_assistant_message` / `response` / …). */
  inlineResponse: string;
  transcriptPath: string;
}

export interface StopResponse {
  /** Raw reply text before display sanitising; '' when nothing was found. */
  text: string;
  /** Codex's recorded failure for the turn, when its rollout was read. */
  rollout: CodexTurnOutcome;
}

const NO_OUTCOME: CodexTurnOutcome = { text: '' };

export function resolveStopResponse(input: StopResponseInput, readers: StopResponseReaders): StopResponse {
  if (input.inlineResponse) return { text: input.inlineResponse, rollout: NO_OUTCOME };
  if (input.agentType === 'codex-cli') {
    const rollout = input.transcriptPath
      ? readers.readCodexRolloutPath(input.transcriptPath)
      : readers.readCodexRolloutById(input.sessionId);
    return { text: rollout.text, rollout };
  }
  if (input.agentType === 'claude-code' && input.transcriptPath) {
    return { text: readers.readClaudeTranscript(input.transcriptPath), rollout: NO_OUTCOME };
  }
  return { text: '', rollout: NO_OUTCOME };
}
