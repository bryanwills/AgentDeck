import { State, PermissionMode, PromptOption } from '@streamdeck-claude/shared';

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
        return this.permissionButtons();
      case State.AWAITING_OPTION:
        return this.optionButtons(options);
      case State.AWAITING_DIFF:
        return this.diffButtons();
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
        title: 'TPL 1',
        color: '#1e3a2f',
        textColor: '#6ee7b7',
        enabled: true,
        action: 'template:0',
      },
      {
        title: 'TPL 2',
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

  private permissionButtons(): ButtonConfig[] {
    return [
      {
        title: 'YES',
        color: '#166534',
        textColor: '#ffffff',
        enabled: true,
        action: 'respond:y',
      },
      {
        title: 'NO',
        color: '#991b1b',
        textColor: '#ffffff',
        enabled: true,
        action: 'respond:n',
      },
      {
        title: 'ALWAYS',
        color: '#1e40af',
        textColor: '#ffffff',
        enabled: true,
        action: 'respond:a',
      },
    ];
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

  private diffButtons(): ButtonConfig[] {
    return [
      {
        title: 'APPLY',
        color: '#166534',
        textColor: '#ffffff',
        enabled: true,
        action: 'respond:y',
      },
      {
        title: 'DENY',
        color: '#991b1b',
        textColor: '#ffffff',
        enabled: true,
        action: 'respond:n',
      },
      {
        title: 'VIEW',
        color: '#1e3a5f',
        textColor: '#93c5fd',
        enabled: true,
        action: 'respond:v',
      },
    ];
  }
}
