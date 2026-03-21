/**
 * Registry for encoder action IDs.
 * Breaks circular dependency between encoder-takeover.ts and action modules.
 * Each action module registers its IDs here; encoder-takeover reads from here.
 *
 * Takeover dynamically assigns panels based on active encoder count:
 *   4 groups: Context → Focus → List → Detail
 *   3 groups: Context → Focus → List
 *   2 groups: Focus → List
 *   1 group:  Focus
 */
export const encoderRegistry = {
  utilityIds: [] as string[],  // Utility Dial    — takeover: Context view (4-encoder mode)
  optionIds: [] as string[],   // Response Dial   — takeover: Focus view
  voiceIds: [] as string[],    // Voice Input     — takeover: List view
  itermIds: [] as string[],    // iTerm Dial      — standalone terminal switcher
};

/**
 * Layout state tracking for each encoder type.
 * Shared here to avoid circular deps between encoder-takeover and action modules.
 * Each action module reads/writes its own entry; encoder-takeover resets all on exit.
 */
export const encoderLayout = {
  option: '',
};

/** Reset all layout tracking (called by encoder-takeover on exit). */
export function resetEncoderLayouts(): void {
  encoderLayout.option = '';
}

/**
 * Voice text takeover state.
 * When long transcription text needs all encoder LCDs for word-wrapped display.
 * Handlers set by voice-dial; called by other dials to delegate interactions.
 */
let _vtActive = false;
let _vtRotateHandler: ((ticks: number) => void) | null = null;
let _vtDownHandler: (() => void) | null = null;
let _vtUpHandler: (() => void) | null = null;
let _onVtExitCallback: (() => void) | null = null;

/** Register callback invoked when voice text takeover exits (for refreshing other dials). */
export function setVoiceTextExitCallback(cb: () => void): void {
  _onVtExitCallback = cb;
}

export function isVoiceTextTakeoverActive(): boolean {
  return _vtActive;
}

export function setVoiceTextTakeover(
  active: boolean,
  onRotate?: (ticks: number) => void,
  onDown?: () => void,
  onUp?: () => void,
): void {
  _vtActive = active;
  _vtRotateHandler = active ? (onRotate ?? null) : null;
  _vtDownHandler = active ? (onDown ?? null) : null;
  _vtUpHandler = active ? (onUp ?? null) : null;
  if (!active) _onVtExitCallback?.();
}

export function handleVtRotate(ticks: number): void {
  _vtRotateHandler?.(ticks);
}

export function handleVtDown(): void {
  _vtDownHandler?.();
}

export function handleVtUp(): void {
  _vtUpHandler?.();
}

// ─── Cross-module callbacks (break circular deps) ────────────────

// Cycle 1: encoder-takeover → iterm-dial.resetItermLayout
let _onTakeoverExitCb: (() => void) | null = null;
export function setTakeoverExitCallback(cb: () => void): void { _onTakeoverExitCb = cb; }
export function fireTakeoverExit(): void { _onTakeoverExitCb?.(); }

// Cycle 2: option-dial → encoder-takeover.refreshEncoderTakeover
let _refreshTakeoverCb: ((...args: any[]) => void) | null = null;
export function setRefreshTakeoverCallback(cb: (...args: any[]) => void): void { _refreshTakeoverCb = cb; }
export function fireRefreshTakeover(...args: any[]): void { _refreshTakeoverCb?.(...args); }

// Cycle 3: iterm-dial ↔ session-button
let _switchToPortCb: ((port: number) => void) | null = null;
let _updateItermStateCb: ((...args: any[]) => void) | null = null;
let _suppressAutoSwitchCb: (() => void) | null = null;

export function setSwitchToPortCallback(cb: (port: number) => void): void { _switchToPortCb = cb; }
export function fireSwitchToPort(port: number): void { _switchToPortCb?.(port); }

export function setUpdateItermStateCallback(cb: (...args: any[]) => void): void { _updateItermStateCb = cb; }
export function fireUpdateItermState(...args: any[]): void { _updateItermStateCb?.(...args); }

export function setSuppressAutoSwitchCallback(cb: () => void): void { _suppressAutoSwitchCb = cb; }
export function fireSuppressAutoSwitch(): void { _suppressAutoSwitchCb?.(); }
