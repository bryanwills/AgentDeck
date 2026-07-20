/**
 * Display sleep gate.
 *
 * When the host display sleeps the daemon sends `display_state`, and the plugin
 * blanks every key and encoder LCD (the SDK exposes no brightness control, so
 * "dark" can only mean black pixels).
 *
 * Blanking once at the sleep edge is not enough: several repaint paths run on
 * their own schedule and do not pass through `broadcastStateUpdate()` —
 *   - `usage_update` from the daemon → E2/E3 usage encoders,
 *   - the volume poll timer → E1,
 *   - the awaiting/processing animation timer → keypad slots.
 * Each of those would overwrite the black frame seconds after the display went
 * to sleep. That is why the SD+ encoders appeared not to sleep at all (usage
 * ticks arrive continuously) while a classic Stream Deck looked fine (its keys
 * only repaint when the session list actually changes, which it does not while
 * the machine is idle).
 *
 * So the gate lives here, in one place, and every paint chokepoint consults it
 * instead of relying on the caller to remember.
 */

const BLACK_BUTTON_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" fill="#000"/></svg>'
);
const BLACK_LCD_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#000"/></svg>'
);

let dimmed = false;

export function isDisplayDimmed(): boolean {
  return dimmed;
}

export function setDisplayDimmed(value: boolean): void {
  dimmed = value;
}

/**
 * Paint one action black if the display is asleep. Returns true when it did,
 * so `onWillAppear` handlers can skip their normal render — an action that
 * appears *while* the display is already dark never saw the sleep edge.
 */
export function dimActionIfNeeded(action: unknown, controller: 'Keypad' | 'Encoder'): boolean {
  if (!dimmed) return false;
  const act = action as { setImage?: (v: string) => Promise<void>; setFeedback?: (v: unknown) => Promise<void> };
  if (controller === 'Encoder') {
    void act.setFeedback?.({ canvas: BLACK_LCD_SVG }).catch(() => {});
  } else {
    void act.setImage?.(BLACK_BUTTON_SVG).catch(() => {});
  }
  return true;
}
