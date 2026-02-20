import type { UsageSnapshot } from './types.js';
import { debug } from './logger.js';

export class UsageTracker {
  private startTime = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private toolCalls = 0;

  // Plan-level usage from /usage command
  private sessionPercent: number | null = null;
  private costSpent: number | null = null;
  private costLimit: number | null = null;
  private resetTime: string | null = null;
  private resetDate: string | null = null;

  // PTY-reported duration (overrides timer)
  private ptyDurationSec: number | null = null;

  start(): void {
    this.startTime = Date.now();
  }

  addToolCall(data: Record<string, unknown>): void {
    this.toolCalls++;
    if (typeof data.input_tokens === 'number') {
      this.inputTokens += data.input_tokens;
    }
    if (typeof data.output_tokens === 'number') {
      this.outputTokens += data.output_tokens;
    }
    debug('Usage', `toolCall #${this.toolCalls}: in=${this.inputTokens} out=${this.outputTokens}`);
  }

  addTokens(input: number, output: number): void {
    this.inputTokens += input;
    this.outputTokens += output;
  }

  setDuration(seconds: number): void {
    this.ptyDurationSec = seconds;
  }

  setOutputTokens(tokens: number): void {
    this.outputTokens = tokens;
  }

  incrementToolCalls(): void {
    this.toolCalls++;
  }

  /** Update plan-level usage from /usage command output */
  setUsageInfo(info: Record<string, unknown>): void {
    debug('Usage', `setUsageInfo: ${JSON.stringify(info).slice(0, 120)}`);
    if (typeof info.sessionPercent === 'number') {
      this.sessionPercent = info.sessionPercent;
    }
    if (typeof info.costSpent === 'number') {
      this.costSpent = info.costSpent;
    }
    if (typeof info.costLimit === 'number') {
      this.costLimit = info.costLimit;
    }
    if (typeof info.resetTime === 'string') {
      this.resetTime = info.resetTime;
    }
    if (typeof info.resetDate === 'string') {
      this.resetDate = info.resetDate;
    }
  }

  getSnapshot(): UsageSnapshot {
    const durationMs = this.startTime > 0 ? Date.now() - this.startTime : 0;
    const durationSec = this.ptyDurationSec ?? Math.floor(durationMs / 1000);

    return {
      sessionDurationSec: durationSec,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      toolCalls: this.toolCalls,
      estimatedCostUsd: this.costSpent,
      sessionPercent: this.sessionPercent,
      costSpent: this.costSpent,
      costLimit: this.costLimit,
      resetTime: this.resetTime,
      resetDate: this.resetDate,
    };
  }

  reset(): void {
    this.startTime = Date.now();
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.toolCalls = 0;
    this.sessionPercent = null;
    this.costSpent = null;
    this.costLimit = null;
    this.resetTime = null;
    this.resetDate = null;
    this.ptyDurationSec = null;
  }
}
