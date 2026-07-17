import { describe, expect, it } from 'vitest';
import { PermissionMode, State, type BridgeEvent, type SessionInfo } from '@agentdeck/shared';
import { StateStore } from '../state-store.js';

const claude: SessionInfo = {
  id: 'claude:enhance-timeline',
  port: 9121,
  projectName: 'enhance-timeline',
  agentType: 'claude-code',
  alive: true,
  state: State.PROCESSING,
};

function connectedStore(): StateStore {
  const store = new StateStore();
  store.setConnected(true);
  store.apply({ type: 'sessions_list', sessions: [claude] });
  return store;
}

describe('D200H StateStore session isolation', () => {
  it('does not use the global OpenClaw model while Claude focus is pending', () => {
    const store = connectedStore();
    store.apply({
      type: 'state_update',
      state: State.PROCESSING,
      permissionMode: PermissionMode.DEFAULT,
      sessionId: 'openclaw-gateway',
      focusedSessionId: 'openclaw-gateway',
      agentType: 'openclaw',
      modelName: 'GLM-5.2 (1M)',
    });

    store.prepareFocus(claude.id);
    const detail = store.toLayoutInput(claude.id);
    expect(detail.sessionId).toBe(claude.id);
    expect(detail.modelName).toBeUndefined();
    expect(detail.options).toEqual([]);
  });

  it('ignores unscoped and foreign prompt options for the selected session', () => {
    const store = connectedStore();
    const unscoped = store.apply({
      type: 'prompt_options',
      promptType: 'multi_select',
      options: [{ index: 0, label: 'Run unrelated task' }],
    } as BridgeEvent);
    store.apply({
      type: 'prompt_options',
      sessionId: 'openclaw-gateway',
      focusedSessionId: 'openclaw-gateway',
      promptType: 'multi_select',
      options: [{ index: 0, label: 'Switch to GLM' }],
    } as BridgeEvent);

    expect(unscoped).toBe(false);
    expect(store.toLayoutInput(claude.id).options).toEqual([]);
  });

  it('applies prompt options only to their correlated session', () => {
    const store = connectedStore();
    store.apply({
      type: 'prompt_options',
      sessionId: claude.id,
      focusedSessionId: claude.id,
      promptType: 'yes_no',
      question: 'Allow Edit?',
      options: [{ index: 0, label: 'Yes' }, { index: 1, label: 'No' }],
    } as BridgeEvent);

    expect(store.toLayoutInput(claude.id)).toMatchObject({
      question: 'Allow Edit?',
      options: [{ index: 0, label: 'Yes' }, { index: 1, label: 'No' }],
    });
  });
});
