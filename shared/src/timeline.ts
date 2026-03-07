/**
 * Shared timeline types and log parser for OpenClaw mode.
 * Used by both bridge (BridgeLogStream) and plugin (LogStream).
 */

export type TimelineEntryType =
  | 'tool_request' | 'tool_resolved' | 'chat_start' | 'chat_end'
  | 'chat_response' | 'error' | 'scheduled' | 'user_action'
  | 'model_call' | 'model_response' | 'memory_recall' | 'tool_exec';

export interface TimelineEntry {
  ts: number;
  type: TimelineEntryType;
  raw: string;
  detail?: string;
  approvalId?: string;
  status?: 'pending' | 'approved' | 'denied';
  agentType?: string;
}

/** Parse a single JSON log line into a TimelineEntry, or null if unrecognized. */
export function parseLogLine(json: unknown): TimelineEntry | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;

  const msg = obj.msg as string | undefined;
  const component = obj.component as string | undefined;
  const action = obj.action as string | undefined;
  const model = obj.model as string | undefined;
  const tool = obj.tool as string | undefined;
  const tokens = obj.tokens as number | undefined;
  const rawTs = (obj.ts as number) || (obj.timestamp as number) || (obj.time as number);
  const ts = rawTs || Date.now();

  // Model inference start
  if (model && (action === 'start' || action === 'request' || msg?.includes('inference start') || msg?.includes('model request'))) {
    return { ts, type: 'model_call', raw: `${model} inference started` };
  }

  // Model inference complete
  if (model && (action === 'complete' || action === 'done' || action === 'response' || msg?.includes('inference complete') || msg?.includes('model response'))) {
    // If content is present, emit as chat_response for timeline display
    const content = obj.content as string | undefined;
    if (content && content.length > 10) {
      return {
        ts, type: 'chat_response',
        raw: content.length > 500 ? content.slice(0, 497) + '...' : content,
        detail: content.length > 1000 ? content.slice(0, 997) + '...' : content,
      };
    }
    const parts = [model];
    if (tokens) parts.push(`${tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : tokens} tok`);
    const duration = obj.duration as number | undefined;
    if (duration) parts.push(`${(duration / 1000).toFixed(1)}s`);
    return { ts, type: 'model_response', raw: parts.join(' \u00b7 ') };
  }

  // Memory / recall / search
  if (component === 'memory' || action === 'recall' || action === 'search' ||
      msg?.includes('memory search') || msg?.includes('memory recall')) {
    const query = (obj.query as string) || msg || 'memory search';
    return {
      ts, type: 'memory_recall',
      raw: `Memory: ${query}`,
      detail: query.length > 50 ? query : undefined,
    };
  }

  // Tool execution (non-approval tools, internal operations)
  if (tool || (component === 'tool' && action)) {
    const toolName = tool || action || 'tool';
    const toolDetail = (obj.detail as string) || (obj.command as string) || '';
    const toolRaw = toolDetail ? `${toolName}: ${toolDetail}` : toolName;
    return {
      ts, type: 'tool_exec',
      raw: toolRaw.length > 500 ? toolRaw.slice(0, 497) + '...' : toolRaw,
      detail: toolDetail.length > 100 ? (toolDetail.length > 1000 ? toolDetail.slice(0, 997) + '...' : toolDetail) : undefined,
    };
  }

  // Unrecognized — silently skip
  return null;
}
