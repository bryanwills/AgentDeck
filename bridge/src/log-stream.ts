/**
 * Bridge-side log stream parser for OpenClaw — spawns `openclaw logs --follow --json`
 * and emits TimelineEntry events for relay to Android/plugin clients.
 *
 * Mirror of plugin/src/log-stream.ts but uses shared parseLogLine() and
 * EventEmitter instead of directly writing to a store.
 */

import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { augmentedPath, resolveOpenClawBin } from '@agentdeck/shared';
import type { TimelineEntry } from './types.js';
import { parseLogLine } from './types.js';
import { debug } from './logger.js';

export class BridgeLogStream extends EventEmitter {
  private proc: ChildProcess | null = null;
  private running = false;
  /** Recent tool_request raw texts for dedup against log-based tool_exec */
  private recentToolRequests = new Map<string, number>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.running) return;

    const bin = resolveOpenClawBin();
    debug('log-stream', `Starting log stream: ${bin} logs --follow --json`);

    try {
      this.proc = spawn(bin, ['logs', '--follow', '--json'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, PATH: augmentedPath() },
      });
    } catch (err) {
      debug('log-stream', `Failed to spawn openclaw logs: ${err}`);
      return;
    }

    this.running = true;

    if (this.proc.stdout) {
      const rl = createInterface({ input: this.proc.stdout });
      rl.on('line', (line) => {
        try {
          const parsed = JSON.parse(line);
          const entry = parseLogLine(parsed);
          if (!entry) return;

          // Dedup: skip tool_exec if a matching tool_request was seen recently
          if (entry.type === 'tool_exec' && this.isDuplicateToolExec(entry.raw)) {
            return;
          }

          this.emit('entry', entry);
        } catch {
          // Not valid JSON — ignore
        }
      });

      rl.on('close', () => {
        debug('log-stream', 'Log stream closed');
        this.running = false;
      });
    }

    this.proc.on('error', (err) => {
      debug('log-stream', `Log stream error: ${err.message}`);
      this.running = false;
    });

    this.proc.on('exit', (code) => {
      debug('log-stream', `Log stream exited (code=${code})`);
      this.running = false;
      this.proc = null;
    });

    // Periodic cleanup of stale dedup entries
    this.cleanupTimer = setInterval(() => this.cleanupRecentRequests(), 10_000);
  }

  stop(): void {
    if (this.proc) {
      debug('log-stream', 'Stopping log stream');
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
    this.running = false;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.recentToolRequests.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Track a tool_request from the WS Gateway to avoid duplicating it
   * when the same tool appears in the log stream.
   */
  trackToolRequest(raw: string): void {
    this.recentToolRequests.set(raw, Date.now());
  }

  private isDuplicateToolExec(raw: string): boolean {
    const ts = this.recentToolRequests.get(raw);
    if (!ts) return false;
    if (Date.now() - ts < 5_000) return true;
    this.recentToolRequests.delete(raw);
    return false;
  }

  private cleanupRecentRequests(): void {
    const cutoff = Date.now() - 10_000;
    for (const [key, ts] of this.recentToolRequests) {
      if (ts < cutoff) this.recentToolRequests.delete(key);
    }
  }
}
