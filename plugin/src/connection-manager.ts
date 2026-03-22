/**
 * ConnectionManager — bridge-only connection to daemon/session bridges.
 *
 * All OpenClaw Gateway interaction goes through the daemon (single WS connection).
 * Agent switching sends a `switch_agent` command to the daemon, which broadcasts
 * the appropriate state_update to all clients.
 *
 * Implements AgentLink so plugin.ts can use it as a drop-in replacement for BridgeClient.
 */
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  PluginCommand,
  AgentCapabilities,
} from '@agentdeck/shared';
import type { BridgeEvent } from '@agentdeck/shared';
import type { AgentLink } from './agent-link.js';
import { BridgeClient } from './bridge-client.js';
import { dlog, dinfo, dwarn } from './log.js';

const TAG = 'ConnMgr';

/** Events forwarded from the bridge */
const FORWARDED_EVENTS = [
  'state_update',
  'prompt_options',
  'usage_update',
  'connection',
  'user_prompt',
  'voice_state',
  'timeline_event',
  'timeline_history',
  'display_state',
  'voice_assistant_state',
] as const;

export class ConnectionManager extends EventEmitter implements AgentLink {
  readonly bridge: BridgeClient;
  private started = false;
  private gatewayAvailable = false;

  constructor() {
    super();
    this.bridge = new BridgeClient();
    this.setupBridgeListeners();
  }

  // ===== AgentLink interface =====

  send(command: PluginCommand): void {
    dlog(TAG, `send(${command.type}): bridge=${this.bridge.isConnected()}`);
    if (this.bridge.isConnected()) {
      this.bridge.send(command);
    } else {
      dwarn(TAG, `send(${command.type}) dropped — not connected`);
    }
  }

  isConnected(): boolean {
    return this.bridge.isConnected();
  }

  getCapabilities(): AgentCapabilities | null {
    return this.bridge.getCapabilities();
  }

  disconnect(): void {
    this.bridge.disconnect();
  }

  // ===== Public API =====

  /** Start bridge connection to the given port (or scan for one). */
  start(port?: number): void {
    if (this.started) return;
    this.started = true;
    dinfo(TAG, `start(port=${port ?? 'auto'})`);
    this.bridge.connect(port);
  }

  /** Expose bridge's scanLatestPort setter for plugin.ts */
  set scanLatestPort(fn: (() => number | undefined) | null) {
    this.bridge.scanLatestPort = fn;
  }

  /** Reconnect bridge to a different session port (for session switching). */
  reconnectBridgeTo(port: number): void {
    dlog(TAG, `reconnectBridgeTo(${port})`);
    this.bridge.reconnectTo(port);
  }

  /** Get current bridge port (for session/iterm dial). */
  getBridgePort(): number {
    return this.bridge.getPort();
  }

  // ===== Agent Selection API =====

  /**
   * Switch to OpenClaw via daemon. Reconnects to daemon port and sends switch_agent command.
   * The daemon responds with state_update containing agentType: 'openclaw'.
   */
  switchToOpenClaw(): void {
    dinfo(TAG, 'switchToOpenClaw()');
    const daemonPort = this.findDaemonPort();
    if (daemonPort && this.bridge.getPort() !== daemonPort) {
      // Reconnect to daemon (we may be connected to a session bridge)
      this.bridge.reconnectTo(daemonPort);
    }
    // Send switch_agent command — daemon will broadcast openclaw state
    this.bridge.send({ type: 'switch_agent', agent: 'openclaw' });
  }

  /**
   * Switch to Claude Code. Just sends switch_agent to daemon; caller typically also
   * calls reconnectBridgeTo(sessionPort) to connect to the specific session bridge.
   */
  switchToClaude(): void {
    dinfo(TAG, 'switchToClaude()');
    this.bridge.send({ type: 'switch_agent', agent: 'claude-code' });
  }

  /**
   * Whether OpenClaw Gateway is available (reported by daemon via state_update.gatewayAvailable).
   * Used to determine if OpenClaw should appear in the session cycle list.
   */
  setBridgeGatewayAvailable(available: boolean): void {
    this.gatewayAvailable = available;
  }

  isGatewayAvailable(): boolean {
    return this.gatewayAvailable;
  }

  // ===== Private =====

  /** Read daemon.json to find the daemon's port for OpenClaw reconnection. */
  private findDaemonPort(): number | null {
    try {
      const daemonFile = join(homedir(), '.agentdeck', 'daemon.json');
      const data = readFileSync(daemonFile, 'utf-8');
      const info = JSON.parse(data) as { port: number; pid: number };
      // Verify PID is alive
      try { process.kill(info.pid, 0); } catch { return null; }
      return info.port;
    } catch {
      return null;
    }
  }

  private setupBridgeListeners(): void {
    // Forward all bridge events
    for (const eventName of FORWARDED_EVENTS) {
      this.bridge.on(eventName, (ev: BridgeEvent) => {
        this.emit(eventName, ev);
      });
    }

    this.bridge.on('connected', () => {
      dinfo(TAG, 'Bridge connected');
      this.emit('connected');
    });

    this.bridge.on('disconnected', () => {
      dinfo(TAG, 'Bridge disconnected');
      this.emit('disconnected');
    });
  }
}
