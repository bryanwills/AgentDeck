import type { UtilityMode, RefreshCallback } from './types.js';
import { getVolumeSettings, setInputVolume } from './macos.js';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const POLL_INTERVAL = 2000;
const SKIP_AFTER_ACTION = 3000;

export function createMicMode(refresh: RefreshCallback, step = 1): UtilityMode {
  let volume = 80;
  let muted = false;
  let preMuteVolume = 80;
  let unavailable = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastActionAt = 0;
  let polling = false;

  async function syncFromSystem() {
    if (polling) return;
    if (Date.now() - lastActionAt < SKIP_AFTER_ACTION) return;
    polling = true;
    try {
      const s = await getVolumeSettings();
      if (s.inputVolume === null) {
        unavailable = true;
        refresh();
        return;
      }
      unavailable = false;
      const sysMuted = s.inputVolume === 0;
      if (s.inputVolume !== volume || sysMuted !== muted) {
        volume = s.inputVolume;
        muted = sysMuted;
        if (!muted) preMuteVolume = volume;
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
    id: 'mic',
    label: 'MIC',

    async onActivate() {
      await syncFromSystem();
      startPolling();
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
      if (unavailable) return;
      lastActionAt = Date.now();
      volume = clamp(volume + ticks * step, 0, 100);
      muted = volume === 0;
      setInputVolume(volume);
    },

    async onPush() {
      if (unavailable) return;
      lastActionAt = Date.now();
      if (muted) {
        volume = preMuteVolume || 80;
        muted = false;
      } else {
        preMuteVolume = volume;
        volume = 0;
        muted = true;
      }
      setInputVolume(volume);
    },

    getFeedback() {
      if (unavailable) {
        return {
          title: 'MIC',
          icon: '\uD83C\uDF99',
          value: 'N/A',
          indicator: {
            value: 0,
            bar_fill_c: '#64748b',
          },
        };
      }
      return {
        title: 'MIC',
        icon: '\uD83C\uDF99',
        value: muted ? 'Muted' : `${volume}%`,
        indicator: {
          value: muted ? 0 : volume,
          bar_fill_c: muted ? '#64748b' : '#3b82f6',
        },
      };
    },
  };
}
