/**
 * E3 — Codex usage water-tank dial (Stream Deck+).
 *
 * Phase 2 redesign: this encoder permanently shows the Codex subscription quota
 * (5h + 7d water tanks, from `codexRateLimits`) on its 200×100 LCD. When Codex
 * reports no rate limits the dial falls back to a muted "No Codex usage" note.
 * The UUID (`iterm-dial`) is kept for backward profile compatibility.
 *
 * Rotate / touch: no-op (usage is permanent). Push: request a usage refresh.
 */
import streamDeck, {
  action,
  SingletonAction,
  DialRotateEvent,
  DialDownEvent,
  DialUpEvent,
  WillAppearEvent,
  WillDisappearEvent,
  TouchTapEvent,
} from '@elgato/streamdeck';
import { encoderRegistry, isVoiceTextTakeoverActive, handleVtRotate, handleVtDown, handleVtUp, isDaemonConnected } from '../encoder-registry.js';
import { svgToDataUrl } from '../renderers/button-renderer.js';
import { renderUsageEncoderDual } from '../renderers/water-tank-gauge.js';
import { type UsageModeData, updateUsageModeData, getUsageModeData, fireUsageRefresh, buildCodexUsageEncoder } from '../utility-modes/usage.js';
import type { ConnectionManager } from '../connection-manager.js';
import { renderOfflineTouchStrip } from '../renderers/session-slot-renderer.js';
import { dlog, dinfo } from '../log.js';
import { openAgentDeckAppOrGitHub } from '../utility-modes/macos.js';

const PIXMAP_LAYOUT = 'layouts/voice-layout.json';

let currentLayout = '';
let hasReceivedData = false;

export function initUsageDial(_bridge: ConnectionManager): void {
  dinfo('CodexUsageDial', 'initUsageDial called');
}

/** Called from plugin.ts when usage_update arrives. */
export function updateUsageDialData(data: UsageModeData): void {
  updateUsageModeData(data);
  hasReceivedData = true;
  refreshUsageDials();
}

/** Called from plugin.ts on daemon connect/disconnect to redraw (offline banner). */
export function updateUsageDialState(): void {
  if (!isDaemonConnected()) hasReceivedData = false;
  refreshUsageDials();
}

function ensurePixmapLayout(): void {
  if (currentLayout === PIXMAP_LAYOUT) return;
  currentLayout = PIXMAP_LAYOUT;
  for (const id of encoderRegistry.usageIds) {
    const dial = streamDeck.actions.getActionById(id) as any;
    if (dial) void dial.setFeedbackLayout(PIXMAP_LAYOUT).catch(() => {});
  }
}

function setCanvasFeedback(svg: string): void {
  const feedback = { canvas: svgToDataUrl(svg) };
  for (const id of encoderRegistry.usageIds) {
    const dial = streamDeck.actions.getActionById(id) as any;
    if (dial) void dial.setFeedback(feedback).catch(() => {});
  }
}

function refreshUsageDials(): void {
  if (encoderRegistry.usageIds.length === 0) return;
  ensurePixmapLayout();

  // Offline banner is highest priority and all-or-nothing across the 4 encoders.
  if (!isDaemonConnected()) {
    setCanvasFeedback(renderOfflineTouchStrip(2));
    return;
  }
  if (isVoiceTextTakeoverActive()) return;

  setCanvasFeedback(renderUsageEncoderDual(buildCodexUsageEncoder(getUsageModeData(), hasReceivedData)));
}

@action({ UUID: 'bound.serendipity.agentdeck.iterm-dial' })
export class UsageDialAction extends SingletonAction {
  static get actionIds(): string[] { return encoderRegistry.usageIds; }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    dinfo('CodexUsageDial', `onWillAppear: id=${ev.action.id}`);
    if (!encoderRegistry.usageIds.includes(ev.action.id)) {
      encoderRegistry.usageIds.push(ev.action.id);
    }
    currentLayout = PIXMAP_LAYOUT;
    fireUsageRefresh();
    refreshUsageDials();
  }

  override async onTouchTap(_ev: TouchTapEvent): Promise<void> {
    if (!isDaemonConnected()) {
      void openAgentDeckAppOrGitHub().catch(() => {});
      return;
    }
    if (isVoiceTextTakeoverActive()) { handleVtDown(); return; }
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    if (!isDaemonConnected()) return;
    if (isVoiceTextTakeoverActive()) { handleVtRotate(ev.payload.ticks); return; }
    // Usage is permanent — rotation is a no-op.
  }

  override async onDialDown(_ev: DialDownEvent): Promise<void> {
    if (!isDaemonConnected()) {
      void openAgentDeckAppOrGitHub().catch(() => {});
      return;
    }
    if (isVoiceTextTakeoverActive()) { handleVtDown(); return; }
    // Push: pull fresh usage.
    fireUsageRefresh();
    dlog('CodexUsageDial', 'push: requesting usage refresh');
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    if (isVoiceTextTakeoverActive()) { handleVtUp(); return; }
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    dinfo('CodexUsageDial', `onWillDisappear: id=${ev.action.id}`);
    const idx = encoderRegistry.usageIds.indexOf(ev.action.id);
    if (idx !== -1) {
      encoderRegistry.usageIds.splice(idx, 1);
    }
  }
}
