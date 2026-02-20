import streamDeck, {
  action,
  SingletonAction,
  KeyDownEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from '@elgato/streamdeck';
import { State, PromptOption } from '@agentdeck/shared';
import { BridgeClient } from '../bridge-client.js';
import { LayoutManager, ButtonConfig } from '../layout-manager.js';
import { renderButton, svgToDataUrl } from '../renderers/button-renderer.js';
import { dlog } from '../log.js';

let bridge: BridgeClient;
let layoutManager: LayoutManager;
let currentState = State.DISCONNECTED;
let currentMode = 'default';
let currentOptions: PromptOption[] = [];

// Simple string[] — same pattern as Mode/Stop/Session buttons
const actionIds: string[] = [];

export function initResponseButtons(
  b: BridgeClient,
  lm: LayoutManager,
): void {
  bridge = b;
  layoutManager = lm;
}

export function updateResponseState(
  state: State,
  mode: string,
  options: PromptOption[],
): void {
  currentState = state;
  currentMode = mode;
  currentOptions = options;
  refreshAllButtons();
}

function refreshAllButtons(): void {
  const buttons = layoutManager.getButtonLayout(
    currentState,
    currentMode as any,
    currentOptions,
  );

  dlog('RspBut', `refresh: state=${currentState} ids=${actionIds.length} buttons=[${buttons.map(b => b.title || 'DIM').join(',')}]`);
  for (let i = 0; i < actionIds.length; i++) {
    if (i < buttons.length) {
      applyButtonConfig(actionIds[i], buttons[i]);
    } else {
      // Extra buttons beyond 3 slots → dim them
      applyButtonConfig(actionIds[i], { title: '', color: '#1a1a1a', textColor: '#444444', enabled: false });
    }
  }
}

function applyButtonConfig(actionId: string, config: ButtonConfig): void {
  const svg = renderButton(config);
  const dataUrl = svgToDataUrl(svg);
  const act = streamDeck.actions.getActionById(actionId);
  if (act) {
    void act.setImage(dataUrl).catch((e) => {
      dlog('RspBut', `setImage error: ${e}`);
    });
  }
}

@action({ UUID: 'bound.serendipity.agentdeck.response-button' })
export class ResponseButtonAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (!actionIds.includes(ev.action.id)) {
      actionIds.push(ev.action.id);
    }
    const slot = actionIds.indexOf(ev.action.id);
    dlog('RspBut', `onWillAppear: id=${ev.action.id} slot=${slot} total=${actionIds.length}`);

    const buttons = layoutManager.getButtonLayout(
      currentState,
      currentMode as any,
      currentOptions,
    );
    const config = (slot >= 0 && slot < buttons.length)
      ? buttons[slot]
      : { title: '', color: '#1a1a1a', textColor: '#444444', enabled: false };
    await ev.action.setImage(svgToDataUrl(renderButton(config)));
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const slot = actionIds.indexOf(ev.action.id);
    if (slot < 0) return;

    const buttons = layoutManager.getButtonLayout(
      currentState,
      currentMode as any,
      currentOptions,
    );

    if (slot >= buttons.length) return;

    const config = buttons[slot];
    if (!config.enabled || !config.action) return;

    const actionStr = config.action;
    dlog('RspBut', `keyDown slot=${slot} action="${actionStr}"`);

    if (actionStr === 'interrupt') {
      bridge.send({ type: 'interrupt' });
    } else if (actionStr.startsWith('respond:')) {
      bridge.send({ type: 'respond', value: actionStr.split(':')[1] });
    } else if (actionStr.startsWith('select_option:')) {
      bridge.send({
        type: 'select_option',
        index: parseInt(actionStr.split(':')[1], 10),
      });
    } else if (actionStr.startsWith('switch_mode:')) {
      bridge.send({
        type: 'switch_mode',
        mode: actionStr.split(':')[1] as 'plan' | 'acceptEdits' | 'default',
      });
    } else if (actionStr.startsWith('command:')) {
      bridge.send({ type: 'send_prompt', text: actionStr.substring('command:'.length) });
    } else if (actionStr.startsWith('template:')) {
      bridge.send({
        type: 'send_prompt',
        text: `__template:${actionStr.split(':')[1]}`,
      });
    }
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    const idx = actionIds.indexOf(ev.action.id);
    if (idx !== -1) {
      actionIds.splice(idx, 1);
    }
  }
}
