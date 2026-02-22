import streamDeck from '@elgato/streamdeck';
import { State, PromptOption } from '@agentdeck/shared';
import { encoderRegistry, resetEncoderLayouts, isVoiceTextTakeoverActive, setVoiceTextTakeover } from './encoder-registry.js';
import { svgToDataUrl } from './renderers/button-renderer.js';
import {
  renderContextPanel,
  renderFocusPanel,
  renderListPanel,
  renderDetailPanel,
} from './renderers/option-renderer.js';
import { resetItermLayout } from './actions/iterm-dial.js';
import { dlog } from './log.js';

const PIXMAP_LAYOUT = 'layouts/option-pixmap-layout.json';

let active = false;
let generation = 0;

export function isEncoderTakeoverActive(): boolean {
  return active;
}

/**
 * Collect all active encoder groups in physical left-to-right order.
 * Each group is an array of action IDs (typically 1 per encoder slot).
 */
function getActiveGroups(): string[][] {
  const groups: string[][] = [];
  if (encoderRegistry.utilityIds.length > 0) groups.push(encoderRegistry.utilityIds);
  if (encoderRegistry.optionIds.length > 0) groups.push(encoderRegistry.optionIds);
  if (encoderRegistry.itermIds.length > 0) groups.push(encoderRegistry.itermIds);
  if (encoderRegistry.voiceIds.length > 0) groups.push(encoderRegistry.voiceIds);
  return groups;
}

/** Flatten all encoder IDs from all groups. */
function getAllIds(): string[] {
  return [
    ...encoderRegistry.utilityIds,
    ...encoderRegistry.optionIds,
    ...encoderRegistry.itermIds,
    ...encoderRegistry.voiceIds,
  ];
}

/** Set SVG pixmap canvas feedback on an array of action IDs. */
function setCanvasFeedback(ids: string[], svg: string): void {
  const feedback = { canvas: svgToDataUrl(svg) };
  for (const id of ids) {
    const dial = streamDeck.actions.getActionById(id) as any;
    if (dial) void dial.setFeedback(feedback).catch(() => {});
  }
}

/**
 * Take over all encoder LCDs for unified option display (SVG pixmap).
 * Dynamically uses however many encoder groups are active.
 */
export async function enterEncoderTakeover(): Promise<void> {
  // Voice text takeover must yield to option takeover (higher priority)
  if (isVoiceTextTakeoverActive()) {
    setVoiceTextTakeover(false);
    dlog('Takeover', 'exited voice text takeover (option takeover priority)');
  }
  const gen = ++generation;
  active = true;
  const groups = getActiveGroups();
  dlog('Takeover', `enter ${groups.length} groups (util=${encoderRegistry.utilityIds.length} opt=${encoderRegistry.optionIds.length} iterm=${encoderRegistry.itermIds.length} voice=${encoderRegistry.voiceIds.length})`);

  const promises: Promise<void>[] = [];
  for (const id of getAllIds()) {
    const dial = streamDeck.actions.getActionById(id) as any;
    if (dial) {
      promises.push(dial.setFeedbackLayout(PIXMAP_LAYOUT).catch(() => {}));
    }
  }

  await Promise.all(promises);

  if (gen !== generation) {
    dlog('Takeover', 'enter aborted — generation changed');
  }
}

/**
 * Release all encoder LCDs back to their normal layouts.
 */
export async function exitEncoderTakeover(): Promise<void> {
  const gen = ++generation;
  active = false;
  dlog('Takeover', 'exit');

  resetEncoderLayouts();
  resetItermLayout();

  const promises: Promise<void>[] = [];
  for (const id of getAllIds()) {
    const dial = streamDeck.actions.getActionById(id) as any;
    if (dial) {
      promises.push(dial.setFeedbackLayout('layouts/voice-layout.json').catch(() => {}));
    }
  }

  await Promise.all(promises);

  if (gen !== generation) {
    dlog('Takeover', 'exit aborted — generation changed');
  }
}

/**
 * Panel type assigned per encoder group.
 *
 * Dynamic assignment by active group count:
 *   1 group:  [Focus]
 *   2 groups: [Focus, List]
 *   3 groups: [Context, Focus, List]
 *   4 groups: [Context, Focus, List, Detail]
 *   5+:       extra groups repeat List
 */
type PanelType = 'context' | 'focus' | 'list' | 'detail';

function getPanelAssignment(count: number): PanelType[] {
  switch (count) {
    case 1: return ['focus'];
    case 2: return ['focus', 'list'];
    case 3: return ['context', 'focus', 'list'];
    case 4: return ['context', 'focus', 'list', 'detail'];
    default: {
      // 5+: context, focus, list, detail, then repeat list
      const panels: PanelType[] = ['context', 'focus', 'list', 'detail'];
      for (let i = 4; i < count; i++) panels.push('list');
      return panels;
    }
  }
}

/**
 * Refresh all taken-over encoder LCDs with SVG pixmap rendering.
 * Dynamically assigns panels based on active encoder groups.
 */
export function refreshEncoderTakeover(
  state: State,
  options: PromptOption[],
  selectedIndex: number,
  question?: string,
  currentTool?: string,
  toolInput?: string,
): void {
  if (!active || options.length === 0) return;

  const opt = options[selectedIndex];
  if (!opt) return;

  const isPermission = state === State.AWAITING_PERMISSION;
  const isDiff = state === State.AWAITING_DIFF;
  const isPermOrDiff = isPermission || isDiff;

  const groups = getActiveGroups();
  const panels = getPanelAssignment(groups.length);
  const hasContext = panels.includes('context');

  dlog('Takeover', `refresh ${groups.length} groups: [${panels.join(',')}] idx=${selectedIndex}/${options.length}`);

  for (let i = 0; i < groups.length; i++) {
    let svg: string;
    switch (panels[i]) {
      case 'context':
        svg = renderContextPanel({
          state, selectedIndex, total: options.length,
          question, currentTool,
        });
        break;
      case 'focus':
        svg = renderFocusPanel({
          opt, selectedIndex, total: options.length,
          isPermOrDiff, state, currentTool, fourEnc: hasContext,
        });
        break;
      case 'list':
        svg = renderListPanel({
          options, selectedIndex, isPermOrDiff, state,
        });
        break;
      case 'detail':
        svg = renderDetailPanel({
          opt, isPermOrDiff, state, selectedIndex,
          total: options.length, toolInput, question,
        });
        break;
    }
    setCanvasFeedback(groups[i], svg);
  }
}
