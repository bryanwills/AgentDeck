import { State, PermissionMode, PromptOption } from '@agentdeck/shared';

export interface ButtonConfig {
  title: string;
  color: string;
  textColor: string;
  enabled: boolean;
  action?: string;
}

export interface EncoderConfig {
  title: string;
  value: string;
  indicator: { value: number; bar_fill_c?: string };
  enabled: boolean;
}

const DIM: ButtonConfig = {
  title: '',
  color: '#1a1a1a',
  textColor: '#444444',
  enabled: false,
};

/** Shorten permission/diff option label for button display (max ~9 chars) */
function truncateLabel(label: string): string {
  const lower = label.toLowerCase();
  if (/^yes\b/.test(lower)) return 'YES';
  if (/^no\b/.test(lower) || /^deny\b/.test(lower)) return 'DENY';
  if (/^always\b/.test(lower)) return 'ALWAYS';
  if (/^allow\b/.test(lower)) return 'ALLOW';
  if (/^view\b/.test(lower)) return 'VIEW';
  if (/^apply\b/.test(lower)) return 'APPLY';
  // Unknown: first word, uppercase, max 9 chars
  const first = label.split(/[\s,]+/)[0] || label;
  return first.toUpperCase().slice(0, 9);
}

/** Determine button colors based on shortcut or label semantics */
function colorForOption(opt: PromptOption): { color: string; textColor: string } {
  const s = opt.shortcut?.toLowerCase() ?? '';
  const lower = opt.label.toLowerCase();

  // Blue: always (check before shortcut — "always" has shortcut 'a' but should be blue)
  if (/^always\b/.test(lower)) {
    return { color: '#1e40af', textColor: '#ffffff' };
  }
  // Red: no, deny
  if (s === 'n' || s === 'd' || /^(no|deny)\b/.test(lower)) {
    return { color: '#991b1b', textColor: '#ffffff' };
  }
  // Green: yes, apply, allow (shortcuts y/a)
  if (s === 'y' || s === 'a') {
    return { color: '#166534', textColor: '#ffffff' };
  }
  // Teal default
  return { color: '#1e3a5f', textColor: '#93c5fd' };
}

export class LayoutManager {
  /**
   * Returns 3 ButtonConfigs for dynamic response slots 3-5
   * (Slot 0 = MODE, Slot 1 = SESSION & STATUS, Slot 2 = USAGE, Slot 6 = STOP — handled separately)
   */
  getButtonLayout(
    state: State,
    mode: PermissionMode,
    options: PromptOption[],
  ): ButtonConfig[] {
    switch (state) {
      case State.DISCONNECTED:
        return this.disconnectedButtons();
      case State.IDLE:
        return this.idleButtons();
      case State.PROCESSING:
        return this.processingButtons();
      case State.AWAITING_PERMISSION:
        return this.permissionButtons(options);
      case State.AWAITING_OPTION:
        return this.optionButtons(options);
      case State.AWAITING_DIFF:
        return this.diffButtons(options);
      default:
        return this.disconnectedButtons();
    }
  }

  private disconnectedButtons(): ButtonConfig[] {
    return [DIM, DIM, DIM];
  }

  private idleButtons(): ButtonConfig[] {
    return [
      {
        title: 'FIX',
        color: '#1e3a2f',
        textColor: '#6ee7b7',
        enabled: true,
        action: 'template:0',
      },
      {
        title: 'TEST',
        color: '#1e3a2f',
        textColor: '#6ee7b7',
        enabled: true,
        action: 'template:1',
      },
      {
        title: 'COMPACT',
        color: '#1e293b',
        textColor: '#94a3b8',
        enabled: true,
        action: 'command:/compact',
      },
    ];
  }

  private processingButtons(): ButtonConfig[] {
    return [DIM, DIM, DIM];
  }

  private permissionButtons(options: PromptOption[]): ButtonConfig[] {
    if (options.length === 0) {
      // Fallback: hardcoded YES/NO/ALWAYS
      return [
        { title: 'YES', color: '#166534', textColor: '#ffffff', enabled: true, action: 'respond:y' },
        { title: 'NO', color: '#991b1b', textColor: '#ffffff', enabled: true, action: 'respond:n' },
        { title: 'ALWAYS', color: '#1e40af', textColor: '#ffffff', enabled: true, action: 'respond:a' },
      ];
    }
    return options.slice(0, 3).map(opt => ({
      title: truncateLabel(opt.label),
      ...colorForOption(opt),
      enabled: true,
      action: `respond:${opt.shortcut || 'y'}`,
    }));
  }

  private optionButtons(options: PromptOption[]): ButtonConfig[] {
    const buttons: ButtonConfig[] = [];
    for (let i = 0; i < 3; i++) {
      if (i < options.length) {
        buttons.push({
          title: options[i].label.length > 8
            ? options[i].label.substring(0, 7) + '\u2026'
            : options[i].label,
          color: '#1e3a5f',
          textColor: '#93c5fd',
          enabled: true,
          action: `select_option:${options[i].index}`,
        });
      } else {
        buttons.push(DIM);
      }
    }
    return buttons;
  }

  private diffButtons(options: PromptOption[]): ButtonConfig[] {
    if (options.length === 0) {
      // Fallback: hardcoded APPLY/DENY/VIEW
      return [
        { title: 'APPLY', color: '#166534', textColor: '#ffffff', enabled: true, action: 'respond:a' },
        { title: 'DENY', color: '#991b1b', textColor: '#ffffff', enabled: true, action: 'respond:d' },
        { title: 'VIEW', color: '#1e3a5f', textColor: '#93c5fd', enabled: true, action: 'respond:v' },
      ];
    }
    return options.slice(0, 3).map(opt => ({
      title: truncateLabel(opt.label),
      ...colorForOption(opt),
      enabled: true,
      action: `respond:${opt.shortcut || opt.label.charAt(0).toLowerCase()}`,
    }));
  }
}
