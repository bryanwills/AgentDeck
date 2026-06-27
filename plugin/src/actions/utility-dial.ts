import streamDeck, {
  action,
  SingletonAction,
  DialRotateEvent,
  DialDownEvent,
  DialUpEvent,
  WillAppearEvent,
  WillDisappearEvent,
  DidReceiveSettingsEvent,
  TouchTapEvent,
} from '@elgato/streamdeck';
import { State } from '@agentdeck/shared';
import { isPickerActive, scrollPicker, selectProject } from '../project-picker.js';
import { encoderRegistry, isVoiceTextTakeoverActive, handleVtRotate, handleVtDown, handleVtUp, isDaemonConnected } from '../encoder-registry.js';
import { createModes, modeDots, type UtilityMode } from '../utility-modes/index.js';
import { svgToDataUrl } from '../renderers/button-renderer.js';
import { renderUtilityGeneric, renderUtilityMedia, type UtilityRenderData } from '../renderers/utility-renderer.js';
import { dlog, dinfo, dwarn } from '../log.js';
import { openAgentDeckAppOrGitHub } from '../utility-modes/macos.js';
import { renderOfflineTouchStrip } from '../renderers/session-slot-renderer.js';

import type { JsonValue } from '@elgato/utils';

interface UtilityDialSettings {
  [key: string]: JsonValue;
  enabledModes?: string | string[];
}

const DEFAULT_MODES = ['volume'];

/** Normalize enabledModes (string or string[]) to comma-separated string. */
function normalizeEnabledModes(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val.length > 0 ? val.join(',') : DEFAULT_MODES.join(',');
  if (typeof val === 'string' && val.trim()) return val;
  return DEFAULT_MODES.join(',');
}

const PIXMAP_LAYOUT = 'layouts/voice-layout.json';

const LONG_PRESS_MS = 500;

let setupRequired = false;
let modes: UtilityMode[] = [];
let activeIndex = 0;
let settings: UtilityDialSettings = {};
let currentLayout = PIXMAP_LAYOUT;
let dialDownTime = 0;

function rebuildModes(): void {
  // Deactivate all existing modes (full cleanup — stops timer etc.)
  for (const m of modes) m.onDeactivate?.();

  modes = createModes(normalizeEnabledModes(settings.enabledModes), {
    refresh: refreshUtilityDials,
  });
  activeIndex = 0;
  dinfo('UtilDial', `rebuildModes: ${modes.length} modes [${modes.map(m => m.id).join(',')}]`);
  if (modes.length > 0) {
    // Activate first mode, then refresh LCD when system values are fetched
    const first = modes[0];
    if (first.onActivate) {
      void first.onActivate().then(() => refreshUtilityDials()).catch((e) => {
        dwarn('UtilDial', `onActivate error: ${e}`);
      });
    }
  }
}

export function setUtilitySetupRequired(value: boolean): void {
  setupRequired = value;
  refreshUtilityDials();
}

export function initUtilityDial(): void {
  dinfo('UtilDial', 'initUtilityDial called');
  rebuildModes();
}

export function updateUtilityDialState(_state: State): void {
  // Utility modes (volume/media/etc.) are session-independent; the offline banner
  // and input gating now key off isDaemonConnected(), so session state is unused.
  // Force layout re-apply on next refresh (covers voice-text-takeover exit).
  currentLayout = '';
  refreshUtilityDials();
}

function ensurePixmapLayout(): void {
  if (currentLayout === PIXMAP_LAYOUT) return;
  currentLayout = PIXMAP_LAYOUT;
  for (const id of encoderRegistry.utilityIds) {
    const dial = streamDeck.actions.getActionById(id) as any;
    if (dial) void dial.setFeedbackLayout(PIXMAP_LAYOUT).catch(() => {});
  }
}

export function refreshUtilityDials(): void {
  // Offline banner is highest priority and all-or-nothing across the 4 encoders.
  // Gate on real daemon-down, NOT session-level currentState === DISCONNECTED
  // (which flips transiently during multi-session switching while the daemon is up).
  if (!isDaemonConnected()) {
    ensurePixmapLayout();
    const svg = renderOfflineTouchStrip(0);
    const canvasFeedback = { canvas: svgToDataUrl(svg) };
    for (const id of encoderRegistry.utilityIds) {
      const dial = streamDeck.actions.getActionById(id) as any;
      if (dial) void dial.setFeedback(canvasFeedback).catch(() => {});
    }
    return;
  }

  if (isVoiceTextTakeoverActive()) return;

  if (modes.length === 0) return;

  ensurePixmapLayout();

  const mode = modes[activeIndex];
  const feedback = mode.getFeedback();
  const dots = modeDots(activeIndex, modes.length);

  // Build render data from mode feedback
  const indicator = (feedback.indicator as { value: number; bar_fill_c: string }) || { value: 0, bar_fill_c: '#333' };
  const data: UtilityRenderData = {
    title: String(feedback.title ?? ''),
    icon: feedback.icon != null ? String(feedback.icon) : undefined,
    value: feedback.value != null ? String(feedback.value) : undefined,
    indicator,
    dots,
    state: feedback.state != null ? String(feedback.state) : undefined,
    track: feedback.track != null ? String(feedback.track) : undefined,
    artist: feedback.artist != null ? String(feedback.artist) : undefined,
  };

  // Media mode has track field; generic for everything else
  const isMedia = data.track !== undefined;
  const svg = isMedia ? renderUtilityMedia(data) : renderUtilityGeneric(data);
  const canvasFeedback = { canvas: svgToDataUrl(svg) };

  for (const id of encoderRegistry.utilityIds) {
    const dial = streamDeck.actions.getActionById(id) as any;
    if (dial) void dial.setFeedback(canvasFeedback).catch(() => {});
  }
}

@action({ UUID: 'bound.serendipity.agentdeck.utility-dial' })
export class UtilityDialAction extends SingletonAction {
  static get actionIds(): string[] { return encoderRegistry.utilityIds; }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    dinfo('UtilDial', `onWillAppear: id=${ev.action.id} controller=${ev.payload.controller}`);
    if (!encoderRegistry.utilityIds.includes(ev.action.id)) {
      encoderRegistry.utilityIds.push(ev.action.id);
    }

    // Load settings
    const s = (ev.payload?.settings ?? {}) as UtilityDialSettings;
    if (s.enabledModes) {
      // Migrate legacy comma-string to array so PI checkbox-list shows correctly
      if (typeof s.enabledModes === 'string') {
        s.enabledModes = s.enabledModes.split(',').map(x => x.trim()).filter(Boolean);
        void ev.action.setSettings(s as Record<string, JsonValue>).catch(() => {});
      }
      settings = s;
    } else {
      // Persist defaults so PI checkbox-list shows them checked
      settings = { enabledModes: [...DEFAULT_MODES] };
      void ev.action.setSettings(settings as Record<string, JsonValue>).catch(() => {});
    }
    rebuildModes();
    refreshUtilityDials();
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<UtilityDialSettings>): void {
    dlog('UtilDial', `onDidReceiveSettings: ${JSON.stringify(ev.payload.settings)}`);
    settings = ev.payload.settings;
    rebuildModes();
    refreshUtilityDials();
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    dlog('UtilDial', `onTouchTap: modes=${modes.length} hold=${ev.payload.hold}`);
    if (!isDaemonConnected()) {
      void openAgentDeckAppOrGitHub().catch(() => {});
      return;
    }
    if (modes.length <= 1) return;

    // Pause current mode (stops polling etc. but preserves state)
    const prev = modes[activeIndex];
    prev.onPause?.();

    activeIndex = (activeIndex + 1) % modes.length;
    const next = modes[activeIndex];
    dlog('UtilDial', `touch: mode=${next.id} idx=${activeIndex}`);

    // Resume or activate new mode
    const resumeOrActivate = next.onResume ?? next.onActivate;
    if (resumeOrActivate) {
      void resumeOrActivate().then(() => refreshUtilityDials()).catch((e) => {
        dwarn('UtilDial', `onResume/Activate error: ${e}`);
      });
    }
    // Immediate refresh with local state (optimistic)
    refreshUtilityDials();
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    dlog('UtilDial', `onDialRotate: modes=${modes.length} ticks=${ev.payload.ticks}`);
    if (!isDaemonConnected()) return;
    if (isPickerActive()) { scrollPicker(ev.payload.ticks); return; }
    if (isVoiceTextTakeoverActive()) { handleVtRotate(ev.payload.ticks); return; }
    if (modes.length === 0) return;

    await modes[activeIndex].onRotate(ev.payload.ticks);
    dlog('UtilDial', `rotate done: mode=${modes[activeIndex].id}`);
    refreshUtilityDials();
  }

  override async onDialDown(ev: DialDownEvent): Promise<void> {
    dlog('UtilDial', `onDialDown: modes=${modes.length}`);
    if (!isDaemonConnected()) {
      void openAgentDeckAppOrGitHub().catch(() => {});
      return;
    }
    if (isPickerActive()) { void selectProject(); return; }
    if (isVoiceTextTakeoverActive()) { handleVtDown(); return; }
    dialDownTime = Date.now();
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    if (isVoiceTextTakeoverActive()) { handleVtUp(); return; }
    if (modes.length === 0) return;

    const mode = modes[activeIndex];
    const elapsed = Date.now() - dialDownTime;

    if (elapsed >= LONG_PRESS_MS && mode.onLongPush) {
      dlog('UtilDial', `longPush (${elapsed}ms): mode=${mode.id}`);
      await mode.onLongPush();
    } else {
      dlog('UtilDial', `push (${elapsed}ms): mode=${mode.id}`);
      await mode.onPush();
    }
    refreshUtilityDials();
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    dinfo('UtilDial', `onWillDisappear: id=${ev.action.id}`);
    const idx = encoderRegistry.utilityIds.indexOf(ev.action.id);
    if (idx !== -1) {
      encoderRegistry.utilityIds.splice(idx, 1);
    }
    // Full cleanup — deactivate all modes (stops timers etc.)
    for (const m of modes) m.onDeactivate?.();
  }
}
