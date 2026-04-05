import WebSocket from 'ws';
import { EventEmitter } from 'events';
import {
  BridgeEvent,
  PluginCommand,
  AgentCapabilities,
  BRIDGE_WS_PORT,
  RECONNECT_INTERVAL_MS,
  WS_ACTIVITY_TIMEOUT_MS,
} from '@agentdeck/shared';
import type { AgentLink } from './agent-link.js';
import { dlog, dwarn, derr } from './log.js';

export class BridgeClient extends EventEmitter implements AgentLink {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private _watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private _lastActivityAt = 0;
  private _connected = false;
  private _port = BRIDGE_WS_PORT;
  private _connectGeneration = 0;
  private _capabilities: AgentCapabilities | null = null;

  connect(port?: number): void {
    if (port != null) this._port = port;
    dlog('Bridge', `connect(port=${this._port})`);
    this.cleanup();
    this._connectGeneration++;
    const gen = this._connectGeneration;
    this.attemptConnect(gen);
    this.reconnectTimer = setInterval(() => {
      if (!this._connected && gen === this._connectGeneration) {
        this.attemptConnect(gen);
      }
    }, RECONNECT_INTERVAL_MS);
  }

  /** Reconnect to a different session on a different port */
  reconnectTo(port: number): void {
    dlog('Bridge', `reconnectTo(port=${port})`);
    this._port = port;
    // Clean up old connection without emitting 'disconnected'
    this.cleanup();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this.connect(port);
  }

  disconnect(): void {
    dlog('Bridge', 'disconnect()');
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this.emit('disconnected');
  }

  send(command: PluginCommand): void {
    if (this.ws && this._connected) {
      dlog('Bridge', `send(${command.type})`);
      this.ws.send(JSON.stringify(command));
    } else {
      dwarn('Bridge', `send(${command.type}) dropped — not connected`);
    }
  }

  isConnected(): boolean {
    return this._connected;
  }

  getCapabilities(): AgentCapabilities | null {
    return this._capabilities;
  }

  getPort(): number {
    return this._port;
  }

  private attemptConnect(gen: number): void {
    if (gen !== this._connectGeneration) return;

    if (this.ws) {
      if (this.ws.readyState === WebSocket.CONNECTING) {
        dlog('Bridge', 'attemptConnect skipped: socket still connecting')
        return;
      }
      const staleWs = this.ws;
      this.ws = null;
      staleWs.removeAllListeners();
      try {
        if (
          staleWs.readyState === WebSocket.OPEN ||
          staleWs.readyState === WebSocket.CLOSING
        ) {
          staleWs.close();
        }
      } catch (err) {
        dlog('Bridge', `stale socket cleanup ignored: ${err}`);
      }
    }

    try {
      dlog('Bridge', `attemptConnect ws://localhost:${this._port} (gen=${gen})`);
      this.ws = new WebSocket(`ws://localhost:${this._port}`);

      this.ws.on('open', () => {
        if (gen !== this._connectGeneration) return;
        dlog('Bridge', 'WebSocket open');
        this._connected = true;
        this._lastActivityAt = Date.now();
        this.startWatchdog(gen);
        this.emit('connected');
      });

      this.ws.on('ping', () => {
        this._lastActivityAt = Date.now();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        if (gen !== this._connectGeneration) return;
        this._lastActivityAt = Date.now();
        try {
          const event = JSON.parse(data.toString()) as BridgeEvent;
          dlog('Bridge', `recv(${event.type})`);
          // Track agent capabilities from state updates
          if (event.type === 'state_update' && event.agentCapabilities) {
            this._capabilities = event.agentCapabilities;
          }
          this.emit(event.type, event);
        } catch (err) {
          derr('Bridge', `message parse error: ${err}`);
        }
      });

      this.ws.on('close', () => {
        if (gen !== this._connectGeneration) return;
        const wasConnected = this._connected;
        this._connected = false;
        if (wasConnected) {
          dlog('Bridge', 'WebSocket closed (was connected)');
          this.emit('disconnected');
        }
      });

      this.ws.on('error', (err) => {
        if (gen !== this._connectGeneration) return;
        dlog('Bridge', `WebSocket error: ${err.message}`);
      });
    } catch (err) {
      dlog('Bridge', `attemptConnect exception: ${err}`);
    }
  }

  private _lastWatchdogTick = Date.now();

  private startWatchdog(gen: number): void {
    this.stopWatchdog();
    this._lastWatchdogTick = Date.now();
    this._watchdogTimer = setInterval(() => {
      if (gen !== this._connectGeneration) return;

      const now = Date.now();
      const tickGap = now - this._lastWatchdogTick;
      this._lastWatchdogTick = now;

      // Detect system wake via time discontinuity (tick should be ~10s, >20s = likely sleep)
      if (tickGap > 20_000) {
        dlog('Bridge', `Wake detected (tick gap ${tickGap}ms)`);
        if (this._connected) {
          // Immediately check if connection is still alive
          try { this.ws?.ping(); } catch { /* ignore */ }
          setTimeout(() => {
            if (gen !== this._connectGeneration) return;
            if (this._connected && Date.now() - this._lastActivityAt > 5_000) {
              dwarn('Bridge', 'No pong after wake — terminating');
              this.ws?.terminate();
            }
          }, 3000);
        } else {
          // Not connected — try immediate reconnect instead of waiting 3s
          this.attemptConnect(gen);
        }
        return;
      }

      if (!this._connected) return;
      const elapsed = now - this._lastActivityAt;
      if (elapsed > WS_ACTIVITY_TIMEOUT_MS) {
        dwarn('Bridge', `No activity for ${elapsed}ms — terminating connection`);
        this.ws?.terminate();
      }
    }, 10_000);
  }

  private stopWatchdog(): void {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopWatchdog();
  }
}
