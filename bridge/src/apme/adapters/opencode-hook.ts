/**
 * OpenCode SSE → TelemetrySpan adapter.
 *
 * OpenCode (https://github.com/sst/opencode) is the third coding agent
 * AgentDeck monitors. Unlike Claude Code and Codex CLI, it has no command-
 * level hook layer — its lifecycle is observed via the SSE stream emitted by
 * `opencode serve` on its HTTP port. The OpenCode adapter
 * (`bridge/src/adapters/opencode-adapter.ts`) subscribes to that stream and
 * forwards `OpenCodeSSEEvent` payloads into the bridge.
 *
 * This helper takes those SSE payloads and produces the same `TelemetrySpan`
 * shape that `claude-hook.ts` and `codex-hook.ts` emit, so the existing
 * `ApmeCollector.ingestSpan` pipeline handles all three agents uniformly.
 * Without this, OpenCode runs never reach APME — they fall back to
 * `session_end`-only task boundaries (one task per session, defeating
 * per-task evaluation).
 *
 * Detected boundary signals (priority order):
 *   1. `todo_complete` — `message.part.updated` carrying a tool part whose
 *      tool name is "todowrite" and whose `state.output` reports every todo
 *      with `status === 'completed'`. OpenCode's todowrite tool is the
 *      analogue of Claude's TodoWrite + Codex's todo manager.
 *   2. `idle_gap` — the adapter arms a timer on `session.idle` and fires
 *      `opencodeIdleGapTaskBoundary` after OPENCODE_IDLE_GAP_MS with no new
 *      work (mirrors the OpenClaw idle-gap segmentation). Without it,
 *      OpenCode tasks close only on `session_end` — one task per session,
 *      defeating per-task evaluation.
 *   3. (`/clear` and `manual` are reserved for future direct integrations —
 *      OpenCode doesn't currently surface either via SSE.)
 *
 * Tool calls and tool results map to `tool_call` / `tool_result` spans for
 * step-level parity with Claude / Codex (drives the timeline and the
 * deterministic Layer 1 efficiency metrics).
 */

import { randomUUID } from 'crypto';
import type {
  AdapterContext,
  TelemetrySpan,
  TelemetryAttributes,
} from '@agentdeck/shared';
import { spanNameForKind } from '@agentdeck/shared';
import type { OpenCodeMessagePart, OpenCodeMessageInfo } from '../../opencode-client.js';

/**
 * Convert a single OpenCode SSE `message.part.updated` payload into spans.
 *
 * Returns an empty array when the part isn't APME-relevant (text / step-finish
 * are accumulated elsewhere). Caller is expected to drop empty arrays.
 */
export function opencodePartToSpans(
  ctx: AdapterContext,
  part: OpenCodeMessagePart,
): TelemetrySpan[] {
  if (part.type !== 'tool') return [];

  const ts = Date.now();
  const toolName = (part.tool ?? 'unknown').toLowerCase();
  const status = part.state?.status ?? 'running';
  const baseAttrs: TelemetryAttributes = {
    'agentdeck.agent_type': ctx.agentType,
    ...(ctx.cwd ? { 'agentdeck.cwd': ctx.cwd } : {}),
    'gen_ai.tool.name': toolName,
    'agentdeck.tool_name': toolName,
    'agentdeck.raw_payload': part as unknown as Record<string, unknown>,
  };
  const make = (
    kind: TelemetrySpan['kind'],
    attributes: TelemetryAttributes = {},
  ): TelemetrySpan => ({
    traceId: ctx.traceId,
    spanId: randomUUID(),
    parentSpanId: ctx.activeTurnId,
    name: spanNameForKind(kind),
    kind,
    ts,
    attributes: { ...baseAttrs, ...attributes },
  });

  const spans: TelemetrySpan[] = [];
  if (status === 'completed') {
    spans.push(make('tool_result'));
    // todowrite completion with every item marked 'completed' is the agent
    // declaring the task done — same semantics as Claude's TodoWrite
    // PostToolUse boundary check in `collector.ts::ingestHook`.
    if (toolName === 'todowrite' && allTodosCompleted(part)) {
      spans.push(make('task_boundary', { 'agentdeck.boundary_signal': 'todo_complete' }));
    }
  } else {
    spans.push(make('tool_call'));
  }
  return spans;
}

/**
 * Spans for a `message.updated` SSE payload. OpenCode emits these on both
 * user prompts (open a turn) and assistant turn-end signals (close it).
 */
export function opencodeMessageToSpans(
  ctx: AdapterContext,
  info: OpenCodeMessageInfo,
  promptText: string | undefined,
  responseText: string | undefined,
): TelemetrySpan[] {
  const ts = Date.now();
  const baseAttrs: TelemetryAttributes = {
    'agentdeck.agent_type': ctx.agentType,
    ...(ctx.cwd ? { 'agentdeck.cwd': ctx.cwd } : {}),
  };
  const make = (
    kind: TelemetrySpan['kind'],
    attributes: TelemetryAttributes = {},
  ): TelemetrySpan => ({
    traceId: ctx.traceId,
    spanId: randomUUID(),
    parentSpanId: ctx.activeTurnId,
    name: spanNameForKind(kind),
    kind,
    ts,
    attributes: { ...baseAttrs, ...attributes },
  });

  const spans: TelemetrySpan[] = [];
  // Attribute the model as soon as an assistant message reveals it. OpenCode's
  // SSE `message.updated` carries modelID/providerID, but that only ever
  // reached the display StateMachine — the APME span pipeline never emitted a
  // session_meta span, so every opencode run persisted model_id=NULL. Emitting
  // it here routes through collector.ts (gen_ai.request.model -> updateModel),
  // which writes directly to the bound APME session (no StateMachine reliance).
  if (info.role === 'assistant' && info.modelID) {
    const model = info.providerID ? `${info.providerID}/${info.modelID}` : info.modelID;
    spans.push(make('session_meta', { 'gen_ai.request.model': model }));
  }
  if (info.role === 'user' && promptText) {
    spans.push(make('turn_start', { 'agentdeck.prompt_text': promptText }));
  } else if (info.role === 'assistant' && responseText) {
    spans.push(make('turn_response', { 'agentdeck.response_text': responseText }));
  }
  return spans;
}

/** How long a session must sit idle (no new work after `session.idle`)
 *  before the active task closes with an `idle_gap` boundary. Matches
 *  OPENCLAW_IDLE_GAP_MS — the two adapters segment on the same rhythm. */
export const OPENCODE_IDLE_GAP_MS = 90_000;

/** Build the `task_boundary` (idle_gap) span the adapter emits when the
 *  idle-gap timer fires. Mirrors `openclawIdleGapTaskBoundary`. */
export function opencodeIdleGapTaskBoundary(ctx: AdapterContext): TelemetrySpan {
  return {
    traceId: ctx.traceId,
    spanId: randomUUID(),
    parentSpanId: ctx.activeTurnId,
    name: spanNameForKind('task_boundary'),
    kind: 'task_boundary',
    ts: Date.now(),
    attributes: {
      'agentdeck.agent_type': ctx.agentType,
      ...(ctx.cwd ? { 'agentdeck.cwd': ctx.cwd } : {}),
      'agentdeck.boundary_signal': 'idle_gap',
    },
  };
}

/**
 * Read the todos array out of an OpenCode todowrite tool part. OpenCode's
 * todowrite stores its state under `part.state.output` as a JSON string of
 * `{ todos: [{ status, ... }] }` (the same shape Claude Code's TodoWrite
 * uses). Returns true when every entry is `completed`. Empty list returns
 * false — we shouldn't treat "no todos" as task completion.
 */
function allTodosCompleted(part: OpenCodeMessagePart): boolean {
  // Try input first (some OpenCode versions echo the final todos list there).
  const inputTodos = readTodosFromUnknown(part.state?.input);
  if (inputTodos && inputTodos.length > 0 && inputTodos.every((t) => t.status === 'completed')) {
    return true;
  }
  // Output is usually a JSON-encoded string.
  const output = part.state?.output;
  if (typeof output === 'string') {
    try {
      const parsed = JSON.parse(output) as unknown;
      const todos = readTodosFromUnknown(parsed);
      if (todos && todos.length > 0) {
        return todos.every((t) => t.status === 'completed');
      }
    } catch {
      // ignore malformed output — treat as not-all-completed
    }
  }
  return false;
}

function readTodosFromUnknown(value: unknown): Array<{ status: string }> | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const candidates = [obj.todos, (obj as { tool_input?: { todos?: unknown } }).tool_input?.todos];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      return c
        .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
        .map((it) => ({ status: String(it.status ?? '') }));
    }
  }
  return null;
}
