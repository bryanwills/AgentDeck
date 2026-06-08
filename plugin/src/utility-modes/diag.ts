import type { UtilityMode, RefreshCallback } from './types.js';
import { BRIDGE_WS_PORT } from '@agentdeck/shared';
import { dlog, dwarn } from '../log.js';

const TAG = 'Diag';

type DiagStatus = 'ok' | 'error' | 'offline' | 'dumping';

export function createDiagMode(refresh: RefreshCallback): UtilityMode {
  let status: DiagStatus = 'ok';
  let lastError: string | null = null;
  let lastDumpTime: string | null = null;
  let bridgePort = BRIDGE_WS_PORT;

  async function checkBridge(): Promise<void> {
    try {
      const res = await fetch(`http://127.0.0.1:${bridgePort}/health`);
      if (res.ok) {
        status = 'ok';
        lastError = null;
      } else {
        status = 'error';
        lastError = `HTTP ${res.status}`;
      }
    } catch {
      status = 'offline';
      lastError = 'AgentDeck Offline';
    }
    refresh();
  }

  async function triggerDump(): Promise<void> {
    status = 'dumping';
    refresh();
    try {
      const res = await fetch(`http://127.0.0.1:${bridgePort}/diag`);
      if (res.ok) {
        lastDumpTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
        status = 'ok';
        dlog(TAG, `Dump triggered at ${lastDumpTime}`);
      } else {
        status = 'error';
        lastError = `Dump failed: ${res.status}`;
        dwarn(TAG, lastError);
      }
    } catch (err) {
      status = 'offline';
      lastError = 'AgentDeck Offline';
      dwarn(TAG, `Dump error: ${err}`);
    }
    refresh();
  }

  return {
    id: 'diag',
    label: 'DIAG',

    async onActivate() {
      await checkBridge();
    },

    async onResume() {
      await checkBridge();
    },

    async onRotate(_ticks) {
      // Rotate refreshes bridge status
      await checkBridge();
    },

    async onPush() {
      await triggerDump();
    },

    getFeedback() {
      const icon = status === 'ok' ? '\u2705'        // ✅
        : status === 'dumping' ? '\u23F3'              // ⏳
        : status === 'offline' ? '\u26D4'              // ⛔
        : '\u26A0\uFE0F';                              // ⚠️

      const value = status === 'ok'
        ? (lastDumpTime ? `OK ${lastDumpTime}` : 'OK')
        : status === 'dumping' ? 'Dumping...'
        : (lastError || status);

      const barColor = status === 'ok' ? '#22c55e'
        : status === 'dumping' ? '#f59e0b'
        : '#ef4444';

      return {
        title: 'DIAG',
        icon,
        value,
        indicator: {
          value: status === 'ok' ? 100 : status === 'dumping' ? 50 : 0,
          bar_fill_c: barColor,
        },
      };
    },
  };
}
