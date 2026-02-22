import type { UtilityMode, RefreshCallback } from './types.js';
import { getVolumeSettings, setOutputVolume, setOutputMuted } from './macos.js';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const POLL_INTERVAL = 2000;
const SKIP_AFTER_ACTION = 3000; // skip polling briefly after user action

export function createVolumeMode(refresh: RefreshCallback, step = 1): UtilityMode {
  let volume = 50;
  let muted = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastActionAt = 0;
  let polling = false; // guard against async overlap

  async function syncFromSystem() {
    if (polling) return;
    if (Date.now() - lastActionAt < SKIP_AFTER_ACTION) return;
    polling = true;
    try {
      const s = await getVolumeSettings();
      if (s.outputVolume !== volume || s.outputMuted !== muted) {
        volume = s.outputVolume;
        muted = s.outputMuted;
        refresh();
      }
    } catch { /* ignore */ } finally {
      polling = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(syncFromSystem, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return {
    id: 'volume',
    label: 'VOL',

    async onActivate() {
      await syncFromSystem();
      startPolling(); // always clears previous timer first
    },

    onDeactivate() {
      stopPolling();
    },

    onPause() {
      stopPolling();
    },

    async onResume() {
      await syncFromSystem();
      startPolling();
    },

    async onRotate(ticks) {
      lastActionAt = Date.now();
      volume = clamp(volume + ticks * step, 0, 100);
      muted = false;
      setOutputVolume(volume);
    },

    async onPush() {
      lastActionAt = Date.now();
      muted = !muted;
      setOutputMuted(muted);
    },

    getFeedback() {
      return {
        title: 'VOL',
        icon: muted ? '\uD83D\uDD07' : '\uD83D\uDD0A',
        value: muted ? 'Muted' : `${volume}%`,
        indicator: {
          value: muted ? 0 : volume,
          bar_fill_c: muted ? '#64748b' : '#22c55e',
        },
      };
    },
  };
}
