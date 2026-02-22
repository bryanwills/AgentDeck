/**
 * Interface for utility dial modes.
 * Each mode implements a different macOS utility (volume, brightness, etc.).
 */
export interface UtilityMode {
  id: string;
  label: string;
  onRotate(ticks: number): Promise<void>;
  onPush(): Promise<void>;
  /** Long press action (≥500ms hold). If absent, onPush is used for all presses. */
  onLongPush?(): Promise<void>;
  getFeedback(): Record<string, unknown>;
  onActivate?(): Promise<void>;
  onDeactivate?(): void;
  /** Called when switching away from this mode. Unlike onDeactivate, preserves state for resume. */
  onPause?(): void;
  /** Called when switching back to this mode. */
  onResume?(): Promise<void>;
}

/** Callback to trigger LCD refresh from within a mode (e.g. timer tick). */
export type RefreshCallback = () => void;
