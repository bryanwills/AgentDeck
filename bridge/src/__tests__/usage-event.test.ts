import { describe, expect, it } from 'vitest';
import { PermissionMode, State, type StateSnapshot, type UsageEvent } from '../types.js';
import { buildUsageEvent } from '../usage-event.js';
import type { ApiUsageData } from '../usage-api.js';

function snapshot(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    state: State.IDLE,
    permissionMode: PermissionMode.DEFAULT,
    currentTool: null,
    toolInput: null,
    toolProgress: null,
    options: [],
    question: null,
    navigable: false,
    cursorIndex: 0,
    projectName: 'AgentDeck',
    modelName: null,
    effortLevel: null,
    billingType: 'unknown',
    sessionDurationSec: 0,
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
    estimatedCostUsd: null,
    sessionPercent: null,
    costSpent: null,
    costLimit: null,
    resetTime: null,
    resetDate: null,
    suggestedPrompt: null,
    remoteUrl: null,
    ...overrides,
  };
}

function usage(overrides: Partial<ApiUsageData> = {}): ApiUsageData {
  return {
    fiveHourPercent: 55,
    fiveHourResetsAt: '2026-06-06T18:00:00Z',
    sevenDayPercent: 44,
    sevenDayResetsAt: '2026-06-12T18:00:00Z',
    extraUsageEnabled: true,
    extraUsageMonthlyLimit: 100,
    extraUsageUsedCredits: 12,
    extraUsageUtilization: 12,
    inferredBillingType: 'subscription',
    ...overrides,
  };
}

describe('buildUsageEvent subscription quota scoping', () => {
  it('omits Anthropic quota when the model is not yet known', () => {
    const evt = buildUsageEvent(
      snapshot({ billingType: 'subscription' }),
      usage(),
      true,
    ) as UsageEvent;

    expect(evt.fiveHourPercent).toBeUndefined();
    expect(evt.sevenDayPercent).toBeUndefined();
    expect(evt.extraUsageEnabled).toBeUndefined();
  });

  it('omits Anthropic 5h/7d quota for GLM/API-backed models', () => {
    const evt = buildUsageEvent(
      snapshot({ modelName: 'glm-5.1', billingType: 'subscription' }),
      usage(),
      true,
    ) as UsageEvent;

    expect(evt.fiveHourPercent).toBeUndefined();
    expect(evt.fiveHourResetsAt).toBeUndefined();
    expect(evt.sevenDayPercent).toBeUndefined();
    expect(evt.sevenDayResetsAt).toBeUndefined();
    expect(evt.extraUsageEnabled).toBeUndefined();
    expect(evt.oauthConnected).toBe(true);
  });

  it('keeps Anthropic 5h/7d quota for Claude model aliases', () => {
    const evt = buildUsageEvent(
      snapshot({ modelName: 'opus-4.6', billingType: 'subscription' }),
      usage(),
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    ) as UsageEvent;

    expect(evt.fiveHourPercent).toBe(55);
    expect(evt.sevenDayPercent).toBe(44);
    expect(evt.extraUsageEnabled).toBe(true);
  });
});
