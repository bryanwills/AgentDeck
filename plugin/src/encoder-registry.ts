/**
 * Registry for encoder action IDs (Stream Deck+ E1–E4).
 * Each action module registers its IDs here so cross-cutting features (voice-text
 * takeover, offline banner, project picker) can address every encoder LCD.
 *
 * Phase 2 SD+ roles:
 *   E1 = utility (volume/mic/etc.)   — utilityIds
 *   E2 = Claude usage water-tank     — optionIds (UUID kept as `option-dial`)
 *   E3 = Codex usage water-tank      — usageIds  (UUID kept as `iterm-dial`)
 *   E4 = voice                       — voiceIds
 */
export const encoderRegistry = {
  utilityIds: [] as string[],  // Utility Dial (E1)
  optionIds: [] as string[],   // Claude usage dial (E2)
  voiceIds: [] as string[],    // Voice dial (E4)
  usageIds: [] as string[],    // Codex usage dial (E3)
};

/**
 * Layout state tracking shared with action modules (and the project picker).
 * The voice-text takeover resets this when it releases the borrowed encoder LCDs.
 */
export const encoderLayout = {
  option: '',
};

/** Reset layout tracking (called when voice-text takeover exits). */
export function resetEncoderLayouts(): void {
  encoderLayout.option = '';
}

// ─── Daemon connection state (shared with all four encoder dials) ────────
// The encoder OFFLINE banner (renderOfflineTouchStrip) is an all-or-nothing
// 800px design across 4 encoders, and its messaging ("launch the app") is only
// meaningful when the daemon WS is truly down. Dials must gate the banner on
// THIS flag — set only on real connect/disconnect — never on session-level
// `currentState === DISCONNECTED`, which flips transiently during multi-session
// switching while the daemon stays connected (mirrors the keypad's policy in
// session-slot-button.ts). Kept separate from that module's daemonConnected,
// which has keypad-only side effects (clears sessions, exits detail view).
let _daemonConnected = false;
export function setEncoderDaemonConnected(v: boolean): void { _daemonConnected = v; }
export function isDaemonConnected(): boolean { return _daemonConnected; }

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

// The encoder option-TAKEOVER (E1–E4 commandeered for AWAITING option/permission
// selection) was retired in the Phase 2 SD+ redesign: E2/E3 now permanently show
// Claude/Codex usage, and option/permission selection lives on the keypad detail
// view (session-slot). The takeover cross-module callback cycles were removed
// along with encoder-takeover.ts; only the voice-text-takeover wiring above
// remains (it still borrows the encoder LCDs for transcription review).
