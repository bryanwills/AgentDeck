/**
 * AgentDeck Ulanzi Studio plugin — Node.js main service entry.
 *
 * ONE dynamic action ("AgentDeck"): the user fills the D200H keys with it.
 * Session-centric two-level UX (AgentDeck v4):
 *   • LIST  — one session per key (fixed position, awaiting emphasized).
 *   • DETAIL — press a session → keys reflow to its options / permission /
 *     quick-actions + BACK + STOP.
 * Ulanzi addresses keys as `col_row`; we lay out over whatever keys the user
 * placed the action on. The view (list/detail, focused session, page) is tracked
 * here; `buildSessionDeck` (shared) is the stateless layout engine.
 *
 *   daemon broadcasts → recompute deck → per-key PNG/GIF → Ulanzi
 *   key press → cell action → view change and/or daemon command
 */
import { buildSessionDeck, type DeckView } from '@agentdeck/shared';
import { UlanziApiCtor, type UlanziApi, type UlanziMessage } from './ulanzi.js';
import { DaemonClient } from './daemon-client.js';
import { StateStore } from './state-store.js';
import { svgToBase64Png, ICON_SIZE } from './raster.js';
import { framesToGifBase64 } from './gif.js';
import { launchCompanionApp } from './launch.js';
import { dinfo, dlog, derr, flog } from './log.js';

const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.agentdeck';
const TAG = 'app';

const ANIM_FRAMES = 14;
const ANIM_STEP = 3;
const ANIM_DELAY_MS = 70;
// GIF animation is OFF by default: encoding it for every processing/awaiting
// session each render churns CPU and makes pushes heavy, which the slow D200H
// LCD can't keep up with (laggy, BACK feels unresponsive). Opt in explicitly.
const ANIMATE = process.env.AGENTDECK_ULANZI_ANIM === '1';

interface Instance {
  context: string;
  key: string; // col_row
  lastSig?: string;
}

const $UD: UlanziApi = new UlanziApiCtor();
const daemon = new DaemonClient();
const store = new StateStore();

const instances = new Map<string, Instance>();
let view: DeckView = { mode: 'list', page: 0 };

// Coalesce bursts of daemon broadcasts into at most one render per MIN_GAP.
// Pushing on every event floods Studio→hardware (the LCD can't keep up and
// drops frames, leaving the device stale while Studio's UI stays current).
const MIN_RENDER_GAP_MS = 120;
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let lastRenderAt = 0;
function scheduleRender(): void {
  if (renderTimer) return;
  const wait = Math.max(0, MIN_RENDER_GAP_MS - (Date.now() - lastRenderAt));
  renderTimer = setTimeout(() => {
    renderTimer = null;
    lastRenderAt = Date.now();
    renderAll();
  }, wait);
}

function positions(): string[] {
  return [...instances.values()].map((i) => i.key);
}

// Paced per-key push to the device. Map keeps only the latest image per key.
interface QueueItem { dataUri: string; isGif: boolean; }
const pushQueue = new Map<string, QueueItem>();
const PUSH_PER_TICK = 6;
const PUSH_TICK_MS = 30;
let drainTimer: ReturnType<typeof setInterval> | null = null;
function ensureDrainer(): void {
  if (drainTimer) return;
  drainTimer = setInterval(() => {
    if (pushQueue.size === 0) { if (drainTimer) clearInterval(drainTimer); drainTimer = null; return; }
    let n = 0;
    for (const [ctx, item] of pushQueue) {
      pushQueue.delete(ctx);
      try {
        if (item.isGif) $UD.setGifDataIcon(ctx, item.dataUri);
        else $UD.setBaseDataIcon(ctx, item.dataUri);
      } catch (err) { derr(TAG, `push failed: ${err}`); }
      if (++n >= PUSH_PER_TICK) break;
    }
  }, PUSH_TICK_MS);
}

function deckFor(animFrame: number, animated: boolean) {
  // showUsage pins the bottom-right two AgentDeck keys to 5H/7D gauges (just
  // left of the D200H clock widget) — this surface has no encoder LCD for usage.
  return buildSessionDeck(store.toLayoutInput(), { ...view, animFrame, animated, showUsage: true }, positions());
}

// Compact signature of everything the deck renders from — lets us skip the
// whole rebuild when a daemon broadcast (e.g. processing tool-progress churn)
// changes nothing visible.
function deckSignature(ev: Record<string, unknown>): string {
  const sessions = ((ev.allSessions as Array<Record<string, unknown>>) ?? [])
    .map((s) => `${s.id}:${s.state ?? ''}:${s.currentTool ?? ''}:${s.modelName ?? ''}`).join(',');
  const opts = ((ev.options as Array<{ label?: string }>) ?? []).map((o) => o.label ?? '').join('/');
  // 5H/7D quota rides usage_update, not state_update — without it here a
  // usage-only change would compare equal and the pinned gauges would never
  // refresh (scheduleRender fires but renderAll early-returns on equal sig).
  const usage = `${ev.fiveHourPercent ?? ''}:${ev.sevenDayPercent ?? ''}:${ev.usageKnown ?? ''}`;
  return [ev.state, ev.mode, ev.focusedSessionId ?? ev.sessionId ?? '', ev.requestId ?? '',
    ev.promptType ?? '', ev.currentTool ?? '', opts, usage, sessions].join('|');
}
let lastDeckSig = '';

function renderAll(): void {
  const ev = store.toLayoutInput();
  // If the focused session vanished, drop back to the list.
  if (view.mode === 'detail' && view.openSessionId) {
    const sessions = (ev.allSessions as Array<{ id: string }>) ?? [];
    if (!sessions.some((s) => s.id === view.openSessionId)) view = { mode: 'list', page: 0 };
  }

  // Skip the rebuild+raster when neither the view nor the visible state changed.
  const sig = `${view.mode}|${view.openSessionId ?? ''}|${view.page ?? 0}|${deckSignature(ev)}`;
  if (sig === lastDeckSig) return;
  lastDeckSig = sig;
  lastRenderAt = Date.now();

  const staticDeck = deckFor(0, false);
  const probeDeck = ANIMATE ? deckFor(5, true) : null;
  let frameDecks: ReturnType<typeof deckFor>[] | null = null;
  const getFrameDecks = () =>
    (frameDecks ??= Array.from({ length: ANIM_FRAMES }, (_, i) => deckFor(i * ANIM_STEP, true)));

  // Enqueue changed keys; the drainer paces them to the device (a few per tick).
  // Blasting 12–13 keys at once on a view switch overruns the device — Studio's
  // UI updates but the hardware drops most, leaving stale keys.
  let changed = 0;
  for (const inst of instances.values()) {
    try {
      const cell = staticDeck.get(inst.key);
      const staticSvg = cell?.svg ?? '';
      const animates = ANIMATE && !!cell && probeDeck!.get(inst.key)?.svg !== staticSvg;
      const sig = `${animates ? 'A' : 'S'}|${staticSvg}`;
      if (sig === inst.lastSig) continue;
      inst.lastSig = sig;
      if (!cell) continue;
      let gif: string | null = null;
      if (animates) {
        const frames = getFrameDecks().map((d) => d.get(inst.key)?.svg ?? staticSvg);
        gif = framesToGifBase64({ frames, delayMs: ANIM_DELAY_MS }, ICON_SIZE);
      }
      // Full data URI — the device firmware needs the `data:` prefix to decode
      // (Studio's preview accepts bare base64, the hardware does not).
      pushQueue.set(inst.context, gif
        ? { dataUri: `data:image/gif;base64,${gif}`, isGif: true }
        : { dataUri: `data:image/png;base64,${svgToBase64Png(staticSvg)}`, isGif: false });
      changed++;
    } catch (err) {
      derr(TAG, `render ${inst.key} failed: ${err}`);
    }
  }
  if (changed > 0) { dlog(TAG, `queue ${changed} key(s) (view=${view.mode})`); ensureDrainer(); }
}

// ---- Ulanzi Studio side ----
$UD.connect(PLUGIN_UUID);
$UD.onConnected(() => dinfo(TAG, 'Ulanzi Studio bridge connected'));
$UD.onClose(() => dlog(TAG, 'Ulanzi Studio bridge closed'));
$UD.onError((e) => derr(TAG, `Ulanzi bridge error: ${e}`));

$UD.onAdd((m: UlanziMessage) => {
  flog('RAW', 'onAdd', m);
  instances.set(m.context, { context: m.context, key: m.key });
  dlog(TAG, `add key ${m.key}`);
  scheduleRender(); // coalesce the burst of per-key onAdd at startup
});

$UD.onClear((m: UlanziMessage) => {
  const param = m.param as unknown;
  const items = Array.isArray(param) ? (param as Array<{ context: string }>) : [];
  for (const it of items) instances.delete(it.context);
});

function onPress(m: UlanziMessage): void {
  flog('RAW', 'press', m);
  const inst = instances.get(m.context);
  if (!inst) { flog(TAG, `press: no instance for context ${m.context} (key=${m.key})`); $UD.emit('add', m); return; }
  const known = positions().sort();
  flog(TAG, `press key=${inst.key} view=${view.mode} positions=[${known.join(',')}]`);
  const action = deckFor(0, false).get(inst.key)?.action;
  if (!action) { dlog(TAG, `press ${inst.key} (inert)`); return; }
  switch (action.kind) {
    case 'open':
      view = { mode: 'detail', openSessionId: action.sessionId, page: 0 };
      daemon.send({ type: 'focus_session', sessionId: action.sessionId });
      renderAll();
      break;
    case 'back':
      view = { mode: 'list', page: 0 };
      renderAll();
      break;
    case 'page':
      view = { ...view, page: (view.page ?? 0) + action.delta };
      renderAll();
      break;
    case 'command':
      dlog(TAG, `press ${inst.key} → ${action.command.type}`);
      daemon.send(action.command);
      break;
    case 'launch':
      // Daemon down → there's no WS to send to; open the companion app instead.
      dlog(TAG, `press ${inst.key} → launch companion app`);
      void launchCompanionApp().catch((e) => derr(TAG, `launch failed: ${e}`));
      break;
  }
}
// IMPORTANT: the device fires BOTH `keydown` AND `run` for one physical press
// (~300ms apart). Handle ONLY `run` (the SDK's documented main trigger) so a
// single press is a single action — wiring both double-fires and cancels out
// (open→back). keydown/keyUp are diagnostic-only.
$UD.onRun(onPress);
$UD.onKeyDown((m: UlanziMessage) => flog('RAW', 'keydown(ignored)', m.key));
$UD.onKeyUp((m: UlanziMessage) => flog('RAW', 'keyUp(ignored)', m.key));

// ---- AgentDeck daemon side ----
daemon.on('event', (ev) => { if (store.apply(ev)) scheduleRender(); });
daemon.on('connected', () => {
  dinfo(TAG, 'daemon connected');
  store.setConnected(true);
  // Pull fresh quota immediately so the pinned 5H/7D gauges aren't blank until
  // the next session IDLE transition triggers a usage fetch on the daemon.
  daemon.send({ type: 'query_usage' });
  scheduleRender();
});
daemon.on('disconnected', () => { dlog(TAG, 'daemon disconnected'); store.setConnected(false); view = { mode: 'list', page: 0 }; scheduleRender(); });
daemon.start();

dinfo(TAG, 'AgentDeck Ulanzi plugin started');
