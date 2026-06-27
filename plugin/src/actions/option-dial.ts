/**
 * E2 — Claude usage water-tank dial (Stream Deck+).
 *
 * Phase 2 redesign: this encoder permanently shows the Claude subscription
 * quota (5h + 7d water tanks) on its 200×100 LCD. It never gets commandeered
 * for option/permission selection anymore — that interaction lives on the
 * keypad detail view (session-slot). The suggested-prompt quick-send also moved
 * to a keypad button. The UUID (`option-dial`) is kept for profile/manifest
 * stability even though the role is now "Claude usage".
 *
 * Rotate / touch: no-op (usage is permanent). Push: request a usage refresh.
 */
import streamDeck, {
  action,
  SingletonAction,
  DialRotateEvent,
  DialDownEvent,
  DialUpEvent,
  TouchTapEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from '@elgato/streamdeck';
import type { AgentLink } from '../agent-link.js';
import { encoderRegistry, isVoiceTextTakeoverActive, handleVtRotate, handleVtDown, handleVtUp, isDaemonConnected } from '../encoder-registry.js';
import { svgToDataUrl } from '../renderers/button-renderer.js';
import { renderUsageEncoderDual } from '../renderers/water-tank-gauge.js';
import { type UsageModeData, updateUsageModeData, getUsageModeData, fireUsageRefresh, buildClaudeUsageEncoder } from '../utility-modes/usage.js';
import { renderOfflineTouchStrip } from '../renderers/session-slot-renderer.js';
import { dlog } from '../log.js';
import { openAgentDeckAppOrGitHub } from '../utility-modes/macos.js';

const PIXMAP_LAYOUT = 'layouts/voice-layout.json';

let currentLayout = '';
let hasReceivedData = false;

/** Retained for plugin.ts compatibility; the usage dial has no setup state. */
export function setOptionSetupRequired(_value: boolean): void {
  /* no-op */
}

export function initOptionDial(_b: AgentLink): void {
  // No bridge interaction required — refreshes ride fireUsageRefresh().
}

/** Called from plugin.ts when usage_update arrives. */
export function updateClaudeUsageDial(data: UsageModeData): void {
  updateUsageModeData(data);
  hasReceivedData = true;
  refreshClaudeUsageDials();
}

/** Called from plugin.ts on daemon connect/disconnect to redraw (offline banner). */
export function refreshClaudeUsageDial(): void {
  if (!isDaemonConnected()) hasReceivedData = false;
  refreshClaudeUsageDials();
}

function ensurePixmapLayout(): void {
  if (currentLayout === PIXMAP_LAYOUT) return;
  currentLayout = PIXMAP_LAYOUT;
  for (const id of encoderRegistry.optionIds) {
    const dial = streamDeck.actions.getActionById(id) as any;
    if (dial) void dial.setFeedbackLayout(PIXMAP_LAYOUT).catch(() => {});
  }
}

function setCanvasFeedback(svg: string): void {
  const feedback = { canvas: svgToDataUrl(svg) };
  for (const id of encoderRegistry.optionIds) {
    const dial = streamDeck.actions.getActionById(id) as any;
    if (dial) void dial.setFeedback(feedback).catch(() => {});
  }
}

function refreshClaudeUsageDials(): void {
  if (encoderRegistry.optionIds.length === 0) return;
  ensurePixmapLayout();

  // Offline banner is highest priority and all-or-nothing across the 4 encoders.
  // Gate on real daemon-down, NOT a transient session-level state.
  if (!isDaemonConnected()) {
    setCanvasFeedback(renderOfflineTouchStrip(1));
    return;
  }
  // Voice text takeover paints all encoders itself — skip.
  if (isVoiceTextTakeoverActive()) return;

  setCanvasFeedback(renderUsageEncoderDual(buildClaudeUsageEncoder(getUsageModeData(), hasReceivedData)));
}

@action({ UUID: 'bound.serendipity.agentdeck.option-dial' })
export class ResponseDialAction extends SingletonAction {
  static get actionIds(): string[] { return encoderRegistry.optionIds; }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (!encoderRegistry.optionIds.includes(ev.action.id)) {
      encoderRegistry.optionIds.push(ev.action.id);
    }
    currentLayout = PIXMAP_LAYOUT;
    fireUsageRefresh();
    refreshClaudeUsageDials();
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
    dlog('ClaudeUsageDial', 'push: requesting usage refresh');
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    if (isVoiceTextTakeoverActive()) { handleVtUp(); return; }
  }

  override async onTouchTap(_ev: TouchTapEvent): Promise<void> {
    if (!isDaemonConnected()) {
      void openAgentDeckAppOrGitHub().catch(() => {});
      return;
    }
    if (isVoiceTextTakeoverActive()) { handleVtDown(); return; }
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    const idx = encoderRegistry.optionIds.indexOf(ev.action.id);
    if (idx !== -1) {
      encoderRegistry.optionIds.splice(idx, 1);
    }
  }
}
