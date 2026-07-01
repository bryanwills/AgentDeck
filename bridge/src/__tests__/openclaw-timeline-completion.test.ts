/**
 * OpenClaw turn-completion timeline shape.
 *
 * A chat `final` must produce exactly ONE turn-close row — `chat_response`
 * when there is response text, `chat_end` only for response-less turns
 * (mirrors wireClaudeCodeTimeline's emitCompletion). The previous shape
 * emitted both with the same `detail`, so every OpenClaw turn rendered
 * twice on the flat surfaces (plugin / TUI / persisted timeline.json).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../timeline-summarizer.js', () => ({
  summarizeResponse: vi.fn(async () => 'LLM 요약 라벨'),
}));

import { OpenClawAdapter } from '../adapters/openclaw.js';
import { summarizeResponse } from '../timeline-summarizer.js';
import type { AdapterEvent, TimelineEntry } from '@agentdeck/shared';

interface Emitted { entry: TimelineEntry; upsert?: boolean }

function collectTimeline(adapter: OpenClawAdapter): Emitted[] {
  const out: Emitted[] = [];
  adapter.on('event', (evt: AdapterEvent) => {
    if (evt.source === 'timeline' && evt.entry) {
      out.push({ entry: evt.entry, upsert: evt.upsert });
    }
  });
  return out;
}

function gw(adapter: OpenClawAdapter, event: string, payload: Record<string, unknown>): void {
  (adapter as unknown as { handleGatewayEvent(e: string, p: Record<string, unknown>): void })
    .handleGatewayEvent(event, payload);
}

const msg = (text: string) => ({
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

const LONG_RESPONSE = '이것은 30자를 확실히 넘기는 충분히 긴 최종 응답 텍스트입니다. 요약 대상이 됩니다.';

describe('OpenClaw chat final → single completion row', () => {
  beforeEach(() => {
    vi.mocked(summarizeResponse).mockClear();
  });

  it('emits chat_response only (no chat_end) when the turn has response text', async () => {
    const adapter = new OpenClawAdapter({ autoReconnect: false });
    const rows = collectTimeline(adapter);
    (adapter as unknown as { lastPrompt: string | null }).lastPrompt = '사용자 질문';

    gw(adapter, 'chat', { state: 'delta', runId: 'r1', sessionKey: 's1', ...msg('부분 응답') });
    gw(adapter, 'chat', { state: 'final', runId: 'r1', sessionKey: 's1', ...msg(LONG_RESPONSE) });

    const added = rows.filter((r) => !r.upsert);
    const responses = added.filter((r) => r.entry.type === 'chat_response');
    const ends = added.filter((r) => r.entry.type === 'chat_end');
    expect(responses.length).toBe(1);
    expect(ends.length).toBe(0);
    expect(responses[0].entry.detail).toContain('30자를 확실히 넘기는');
    expect(responses[0].entry.automated).toBeUndefined();
    expect(responses[0].entry.startedAt).toBeTypeOf('number');
    expect(responses[0].entry.endedAt).toBeTypeOf('number');

    // Async LLM summary upserts the SAME chat_response row (not a chat_end).
    await vi.waitFor(() => {
      const upserts = rows.filter((r) => r.upsert && r.entry.summaryKind === 'llm');
      expect(upserts.length).toBe(1);
      expect(upserts[0].entry.type).toBe('chat_response');
      expect(upserts[0].entry.ts).toBe(responses[0].entry.ts);
      expect(upserts[0].entry.raw).toContain('LLM 요약 라벨');
    });
  });

  it('marks gateway-initiated (cron) turns automated and skips LLM enrichment', async () => {
    const adapter = new OpenClawAdapter({ autoReconnect: false });
    const rows = collectTimeline(adapter);

    // No lastPrompt → the delta path flags the chat as automated.
    gw(adapter, 'chat', { state: 'delta', runId: 'r2', sessionKey: 's1', ...msg('부분') });
    gw(adapter, 'chat', { state: 'final', runId: 'r2', sessionKey: 's1', ...msg(LONG_RESPONSE) });

    const response = rows.find((r) => !r.upsert && r.entry.type === 'chat_response');
    expect(response).toBeDefined();
    expect(response!.entry.automated).toBe(true);
    expect(rows.some((r) => !r.upsert && r.entry.type === 'chat_end')).toBe(false);

    // Automated turns skip summarization — the enriched upsert could
    // resurrect a row the store dropped as low-signal polling noise.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(summarizeResponse).not.toHaveBeenCalled();
  });

  it('emits chat_end (not chat_response) for a response-less turn', () => {
    const adapter = new OpenClawAdapter({ autoReconnect: false });
    const rows = collectTimeline(adapter);
    (adapter as unknown as { lastPrompt: string | null }).lastPrompt = '작업 지시';

    gw(adapter, 'chat', { state: 'delta', runId: 'r3', sessionKey: 's1' });
    gw(adapter, 'chat', { state: 'final', runId: 'r3', sessionKey: 's1' });

    const added = rows.filter((r) => !r.upsert);
    expect(added.filter((r) => r.entry.type === 'chat_response').length).toBe(0);
    const ends = added.filter((r) => r.entry.type === 'chat_end');
    expect(ends.length).toBe(1);
    expect(ends[0].entry.summaryKind).toBeDefined();
  });
});
