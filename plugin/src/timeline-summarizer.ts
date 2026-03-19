/**
 * Lightweight timeline summarizer for plugin (no bridge).
 * Tries MLX qwen → heuristic fallback. Ollama skipped to keep plugin lean.
 */

const MLX_URL = 'http://127.0.0.1:8800/chat/completions';
const TIMEOUT_MS = 15_000;
const MAX_INPUT_CHARS = 2000;
const RETRY_INTERVAL_MS = 60_000;

const SYSTEM_PROMPT = `You are a timeline summarizer. Given an AI assistant's response text, produce a single-line Korean summary (max 80 characters) of what was accomplished. Focus on the result, not the process. No quotes, no markdown, no punctuation at the end. Output ONLY the summary line, nothing else.`;

let mlxAvailable: boolean | null = null;
let mlxFailedAt = 0;

export async function summarizeResponse(text: string): Promise<string | null> {
  if (!text || text.length < 20) return null;
  if (mlxAvailable === false && Date.now() - mlxFailedAt < RETRY_INTERVAL_MS) return null;

  const input = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) + '...' : text;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const resp = await fetch(MLX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mlx-community/Qwen3.5-35B-A3B-4bit',
        enable_thinking: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input },
        ],
        max_tokens: 100,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`MLX ${resp.status}`);

    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const cleaned = cleanOutput(content);
    if (cleaned) mlxAvailable = true;
    return cleaned;
  } catch {
    mlxAvailable = false;
    mlxFailedAt = Date.now();
    return null;
  }
}

function cleanOutput(content: string): string | null {
  let cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim();

  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const koreanLine = lines.reverse().find(l => /[\uAC00-\uD7AF]/.test(l));
    cleaned = koreanLine || lines[lines.length - 1];
  }

  cleaned = cleaned
    .replace(/^[-*]\s*/, '')
    .replace(/^["'`"""]+|["'`"""]+$/g, '')
    .replace(/[.。]$/, '')
    .trim();

  if (!cleaned || cleaned.length < 3) return null;
  if (cleaned.length > 80) cleaned = cleaned.slice(0, 77) + '...';
  return cleaned;
}
