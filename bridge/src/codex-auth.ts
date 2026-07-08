import fs from 'fs';
import os from 'os';
import path from 'path';

export interface CodexAuthStatus {
  authMode?: string;
  webAuthConnected?: boolean;
  planType?: string;
  accountId?: string;
  subscriptionActiveUntil?: string;
  lastRefreshAt?: string;
}

function decodeJwtPayload(token?: string): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const json = Buffer.from(base64, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringField(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

const DAY_MS = 86_400_000;

/**
 * Resolve the ChatGPT subscription's *next* renewal date from the snapshot
 * Codex embeds in `auth.json`.
 *
 * Codex stamps `chatgpt_subscription_active_until` (and `..._active_start`)
 * into the `id_token` once, at `codex login` — the pair describes the billing
 * window that was current at `chatgpt_subscription_last_checked`. Crucially,
 * silent token refreshes carry that same snapshot forward verbatim: the window
 * is NOT recomputed on renewal. So for an auto-renewing plan the snapshot's end
 * slides into the past within a cycle even though the subscription is alive and
 * paid — which downstream surfaces (macOS/Android dashboard, D200H) misread as a
 * false "renewal needed".
 *
 * Given the snapshot window `[activeStart, activeUntil]`, roll the end forward
 * by whole billing periods until it lands strictly in the future, yielding the
 * next real renewal boundary. The raw `activeUntil` is returned untouched when
 * it is already future, unparseable, or the window can't be trusted (missing
 * start, non-positive period, or a period outside the monthly/annual 20–400d
 * band) so genuine "malformed"/"unknown" signals still reach the renderers.
 */
export function resolveChatGptRenewalDate(
  activeStart: string | undefined,
  activeUntil: string | undefined,
  now: Date,
): string | undefined {
  if (!activeUntil) return activeUntil;
  const until = Date.parse(activeUntil);
  if (Number.isNaN(until)) return activeUntil;
  const nowMs = now.getTime();
  if (until > nowMs) return activeUntil; // already future — trust the snapshot
  if (!activeStart) return activeUntil; // no window to derive a period from
  const start = Date.parse(activeStart);
  if (Number.isNaN(start)) return activeUntil;
  const period = until - start;
  // Only roll monthly/annual-ish windows; anything shorter or longer is not a
  // trustworthy billing cadence and is left as-is.
  if (period < 20 * DAY_MS || period > 400 * DAY_MS) return activeUntil;
  const missed = Math.max(1, Math.ceil((nowMs - until) / period));
  let rolled = until + missed * period;
  if (rolled <= nowMs) rolled += period; // guarantee strictly future
  return new Date(rolled).toISOString();
}

function authNamespace(payload?: Record<string, unknown> | null): Record<string, unknown> | undefined {
  const candidate = payload?.['https://api.openai.com/auth'];
  return candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : undefined;
}

export function readCodexAuthStatus(): CodexAuthStatus | null {
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    if (!fs.existsSync(authPath)) return null;

    const raw = JSON.parse(fs.readFileSync(authPath, 'utf8')) as Record<string, any>;
    const authMode = stringField(raw.auth_mode);
    const tokens = raw.tokens && typeof raw.tokens === 'object' ? raw.tokens as Record<string, unknown> : {};
    const accessPayload = decodeJwtPayload(stringField(tokens.access_token));
    const idPayload = decodeJwtPayload(stringField(tokens.id_token));
    const accessAuth = authNamespace(accessPayload);
    const idAuth = authNamespace(idPayload);

    const planType = stringField(
      raw.chatgpt_plan_type,
      accessAuth?.chatgpt_plan_type,
      idAuth?.chatgpt_plan_type,
      accessPayload?.chatgpt_plan_type,
      idPayload?.chatgpt_plan_type,
      accessPayload?.plan_type,
      idPayload?.plan_type,
    );
    const accountId = stringField(
      raw.chatgpt_account_id,
      accessAuth?.chatgpt_account_id,
      idAuth?.chatgpt_account_id,
      accessPayload?.chatgpt_account_id,
      idPayload?.chatgpt_account_id,
      accessAuth?.account_id,
      idAuth?.account_id,
      accessPayload?.account_id,
      idPayload?.account_id,
      raw.account_id,
    );
    const subscriptionActiveUntilRaw = stringField(
      raw.chatgpt_subscription_active_until,
      accessAuth?.chatgpt_subscription_active_until,
      idAuth?.chatgpt_subscription_active_until,
      accessPayload?.chatgpt_subscription_active_until,
      idPayload?.chatgpt_subscription_active_until,
      accessPayload?.subscription_active_until,
      idPayload?.subscription_active_until,
    );
    const subscriptionActiveStart = stringField(
      raw.chatgpt_subscription_active_start,
      accessAuth?.chatgpt_subscription_active_start,
      idAuth?.chatgpt_subscription_active_start,
      accessPayload?.chatgpt_subscription_active_start,
      idPayload?.chatgpt_subscription_active_start,
      accessPayload?.subscription_active_start,
      idPayload?.subscription_active_start,
    );
    // Codex never refreshes the login-time window snapshot, so for an
    // auto-renewing plan the raw `active_until` drifts into the past mid-cycle.
    // Roll it to the next real renewal boundary before it reaches any renderer.
    const subscriptionActiveUntil = resolveChatGptRenewalDate(
      subscriptionActiveStart,
      subscriptionActiveUntilRaw,
      new Date(),
    );

    return {
      authMode,
      webAuthConnected: authMode === 'chatgpt' && typeof tokens.access_token === 'string' && tokens.access_token.length > 0,
      planType,
      accountId,
      subscriptionActiveUntil,
      lastRefreshAt: stringField(raw.last_refresh),
    };
  } catch {
    return null;
  }
}
