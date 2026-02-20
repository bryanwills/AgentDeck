import WebSocket from 'ws';
import { EventEmitter } from 'events';
import {
  BridgeEvent,
  PluginCommand,
  BRIDGE_WS_PORT,
  RECONNECT_INTERVAL_MS,
} from '@streamdeck-claude/shared';
import { dlog, dwarn, derr } from './log.js';

export class BridgeClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private _port = BRIDGE_WS_PORT;

  connect(port?: number): void {
    if (port != null) this._port = port;
    dlog('Bridge', `connect(port=${this._port})`);
    this.cleanup();
    this.attemptConnect();
    this.reconnectTimer = setInterval(() => {
      if (!this._connected) {
        this.attemptConnect();
      }
    }, RECONNECT_INTERVAL_MS);
  }

  /** Reconnect to a different session on a different port */
  reconnectTo(port: number): void {
    dlog('Bridge', `reconnectTo(port=${port})`);
    this._port = port;
    this.disconnect();
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

  getPort(): number {
    return this._port;
  }

  private attemptConnect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    try {
      dlog('Bridge', `attemptConnect ws://localhost:${this._port}`);
      this.ws = new WebSocket(`ws://localhost:${this._port}`);

      this.ws.on('open', () => {
        dlog('Bridge', 'WebSocket open');
        this._connected = true;
        this.emit('connected');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString()) as BridgeEvent;
          dlog('Bridge', `recv(${event.type})`);
          this.emit(event.type, event);
        } catch (err) {
          derr('Bridge', `message parse error: ${err}`);
        }
      });

      this.ws.on('close', () => {
        const wasConnected = this._connected;
        this._connected = false;
        if (wasConnected) {
          dlog('Bridge', 'WebSocket closed (was connected)');
          this.emit('disconnected');
        }
      });

      this.ws.on('error', (err) => {
        dlog('Bridge', `WebSocket error: ${err.message}`);
      });
    } catch (err) {
      dlog('Bridge', `attemptConnect exception: ${err}`);
    }
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
