import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { DisplayDimInstruction } from '@agentdeck/shared';

const DEFAULT_DISPLAY_DIM: DisplayDimInstruction = {
  enabled: true,
  mode: 'off',
  level: 10,
};

function clampLevel(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_DISPLAY_DIM.level;
  return Math.max(1, Math.min(100, n));
}

export function normalizeDisplayDimInstruction(input: unknown): DisplayDimInstruction {
  if (!input || typeof input !== 'object') return { ...DEFAULT_DISPLAY_DIM };
  const raw = input as Record<string, unknown>;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_DISPLAY_DIM.enabled,
    mode: raw.mode === 'min' ? 'min' : 'off',
    level: clampLevel(raw.level),
  };
}

function settingsPathCandidates(): string[] {
  const dirs = [process.env.AGENTDECK_DATA_DIR, join(homedir(), '.agentdeck')]
    .filter((dir): dir is string => !!dir);
  return Array.from(new Set(dirs)).map(dir => join(dir, 'settings.json'));
}

export function loadDisplayDimInstruction(): DisplayDimInstruction {
  let best: { mtime: number; parsed: Record<string, unknown> } | null = null;
  for (const path of settingsPathCandidates()) {
    try {
      const mtime = statSync(path).mtimeMs;
      if (best && mtime <= best.mtime) continue;
      best = {
        mtime,
        parsed: JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>,
      };
    } catch {
      // Missing or invalid settings should preserve legacy full-off behavior.
    }
  }
  return normalizeDisplayDimInstruction(best?.parsed.displaySleepDim);
}

export function buildDisplayStateEvent(displayOn: boolean): {
  type: 'display_state';
  displayOn: boolean;
  dim: DisplayDimInstruction;
} {
  return {
    type: 'display_state',
    displayOn,
    dim: loadDisplayDimInstruction(),
  };
}
