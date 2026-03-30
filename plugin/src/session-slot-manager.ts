/**
 * SessionSlotManager — central state machine for v4 dynamic session-per-button layout.
 *
 * Two views:
 * - List View: each button shows one session (OC first, then CC by startedAt)
 * - Detail View: button 1=BACK, button 2=session info, buttons 3-7=options, button 8=ESC/STOP
 */
import type { SessionInfo } from '@agentdeck/shared';
import { State } from '@agentdeck/shared';
import type { PromptOption, AgentType } from '@agentdeck/shared';
import { dlog } from './log.js';

export type SlotView = 'list' | 'detail';

export interface SessionSlotConfig {
  type: 'session' | 'back' | 'info' | 'option' | 'esc' | 'stop' | 'next-page' | 'empty';
  session?: SessionInfo;
  option?: PromptOption;
  optionIndex?: number;
  label?: string;
  /** For list view: is this the currently "active" (connected) session? */
  isActive?: boolean;
}

const SLOTS_PER_PAGE = 7; // When paginating: 7 sessions + 1 nav
const MAX_SESSIONS = 20;
const MAX_SLOTS = 8;

export class SessionSlotManager {
  private _view: SlotView = 'list';
  private _currentPage = 0;
  private _sessions: SessionInfo[] = [];
  private _focusedSessionId: string | null = null;
  private _activeSessionId: string | null = null;
  private _activeSessionPort: number | null = null;
  private _gatewayAvailable = false;

  // Detail view state (from the focused session's bridge)
  private _detailState = State.DISCONNECTED;
  private _detailOptions: PromptOption[] = [];
  private _detailTool: string | undefined;
  private _detailToolInput: string | undefined;
  private _detailQuestion: string | undefined;
  private _detailModelName: string | undefined;
  private _detailMode: string | undefined;

  get view(): SlotView { return this._view; }
  get currentPage(): number { return this._currentPage; }
  get focusedSessionId(): string | null { return this._focusedSessionId; }
  get sessions(): SessionInfo[] { return this._sessions; }
  get detailState(): State { return this._detailState; }
  get detailOptions(): PromptOption[] { return this._detailOptions; }

  // ---- Session list updates ----

  updateSessions(sessions: SessionInfo[], gatewayAvailable: boolean): void {
    this._gatewayAvailable = gatewayAvailable;
    // Build ordered list: OpenClaw first (if available), then CC sessions by startedAt
    const ordered: SessionInfo[] = [];

    // OpenClaw virtual entry
    const ocSession = sessions.find(s => s.agentType === 'openclaw');
    if (ocSession) {
      ordered.push(ocSession);
    } else if (gatewayAvailable) {
      // Create virtual OC session entry
      ordered.push({
        id: 'openclaw-gateway',
        port: 18789,
        projectName: 'OpenClaw',
        agentType: 'openclaw',
        alive: true,
        state: 'idle',
      });
    }

    // CC sessions (exclude daemon, openclaw)
    const ccSessions = sessions
      .filter(s => s.agentType !== 'openclaw' && (s.agentType as string) !== 'daemon' && s.alive)
      .sort((a, b) => a.port - b.port); // port order ≈ startedAt order
    ordered.push(...ccSessions);

    // Cap at MAX_SESSIONS
    this._sessions = ordered.slice(0, MAX_SESSIONS);

    // Clamp page
    const totalPages = this.totalPages();
    if (this._currentPage >= totalPages) {
      this._currentPage = Math.max(0, totalPages - 1);
    }

    dlog('SlotMgr', `updateSessions: ${this._sessions.length} sessions, page=${this._currentPage}, view=${this._view}`);
  }

  setActiveSession(sessionId: string | null, port: number | null): void {
    this._activeSessionId = sessionId;
    this._activeSessionPort = port;
  }

  setGatewayAvailable(available: boolean): void {
    this._gatewayAvailable = available;
  }

  // ---- Detail view state updates ----

  updateDetailState(state: State, options: PromptOption[], tool?: string, toolInput?: string, question?: string, modelName?: string, mode?: string): void {
    this._detailState = state;
    this._detailOptions = options;
    this._detailTool = tool;
    this._detailToolInput = toolInput;
    this._detailQuestion = question;
    this._detailModelName = modelName;
    this._detailMode = mode;
  }

  // ---- View transitions ----

  enterDetailView(sessionId: string): void {
    this._focusedSessionId = sessionId;
    this._view = 'detail';
    dlog('SlotMgr', `enterDetailView: ${sessionId}`);
  }

  exitDetailView(): void {
    this._focusedSessionId = null;
    this._view = 'list';
    dlog('SlotMgr', `exitDetailView → list`);
  }

  nextPage(): void {
    const total = this.totalPages();
    if (total <= 1) return;
    this._currentPage = (this._currentPage + 1) % total;
    dlog('SlotMgr', `nextPage: ${this._currentPage}/${total}`);
  }

  // ---- Slot configuration ----

  getSlotConfig(slot: number): SessionSlotConfig {
    if (slot < 0 || slot >= MAX_SLOTS) return { type: 'empty' };

    if (this._view === 'detail') {
      return this.getDetailSlotConfig(slot);
    }
    return this.getListSlotConfig(slot);
  }

  /** Handle button press. Returns action to take. */
  handleSlotPress(slot: number): {
    action: 'enter-detail' | 'exit-detail' | 'select-option' | 'stop' | 'esc' | 'next-page' | 'none';
    sessionId?: string;
    sessionPort?: number;
    optionIndex?: number;
    optionValue?: string;
  } {
    const config = this.getSlotConfig(slot);

    switch (config.type) {
      case 'session':
        if (config.session) {
          return {
            action: 'enter-detail',
            sessionId: config.session.id,
            sessionPort: config.session.port,
          };
        }
        return { action: 'none' };

      case 'back':
        return { action: 'exit-detail' };

      case 'option':
        if (config.option && config.optionIndex != null) {
          return {
            action: 'select-option',
            optionIndex: config.optionIndex,
            optionValue: config.option.label,
          };
        }
        return { action: 'none' };

      case 'esc':
        return { action: 'esc' };

      case 'stop':
        return { action: 'stop' };

      case 'next-page':
        return { action: 'next-page' };

      default:
        return { action: 'none' };
    }
  }

  getFocusedSession(): SessionInfo | undefined {
    if (!this._focusedSessionId) return undefined;
    return this._sessions.find(s => s.id === this._focusedSessionId);
  }

  // ---- Internal helpers ----

  private totalPages(): number {
    const count = this._sessions.length;
    if (count <= MAX_SLOTS) return 1;
    return Math.ceil(count / SLOTS_PER_PAGE);
  }

  private needsPagination(): boolean {
    return this._sessions.length > MAX_SLOTS;
  }

  private getListSlotConfig(slot: number): SessionSlotConfig {
    const needsPage = this.needsPagination();
    const sessionsOnPage = needsPage ? SLOTS_PER_PAGE : MAX_SLOTS;

    // Last slot on page = NEXT→ when paginating
    if (needsPage && slot === MAX_SLOTS - 1) {
      return { type: 'next-page', label: `${this._currentPage + 1}/${this.totalPages()}` };
    }

    const startIdx = this._currentPage * SLOTS_PER_PAGE;
    const sessionIdx = startIdx + slot;

    if (sessionIdx < this._sessions.length) {
      const session = this._sessions[sessionIdx];
      return {
        type: 'session',
        session,
        isActive: session.id === this._activeSessionId || session.port === this._activeSessionPort,
      };
    }

    return { type: 'empty' };
  }

  private getDetailSlotConfig(slot: number): SessionSlotConfig {
    const session = this.getFocusedSession();
    const isAwaiting = this._detailState === State.AWAITING_OPTION
      || this._detailState === State.AWAITING_PERMISSION
      || this._detailState === State.AWAITING_DIFF;
    const isProcessing = this._detailState === State.PROCESSING;

    switch (slot) {
      case 0:
        // BACK button
        return { type: 'back', label: 'BACK' };

      case 1:
        // Session info
        return { type: 'info', session, label: session?.projectName ?? 'Session' };

      case 7:
        // ESC/STOP
        if (isAwaiting) return { type: 'esc', label: 'ESC' };
        if (isProcessing) return { type: 'stop', label: 'STOP' };
        return { type: 'empty' };

      default: {
        // Slots 2-6: options (AWAITING) or info (other states)
        const optSlot = slot - 2; // 0-4 for slots 2-6

        if (isAwaiting && optSlot < this._detailOptions.length) {
          return {
            type: 'option',
            option: this._detailOptions[optSlot],
            optionIndex: optSlot,
          };
        }

        // PROCESSING: slot 2 shows current tool
        if (isProcessing && slot === 2 && this._detailTool) {
          return {
            type: 'info',
            label: this._detailTool,
            session,
          };
        }

        // IDLE: slot 2 shows model/mode
        if (this._detailState === State.IDLE && slot === 2) {
          const parts = [this._detailModelName, this._detailMode].filter(Boolean);
          if (parts.length > 0) {
            return { type: 'info', label: parts.join(' / '), session };
          }
        }

        return { type: 'empty' };
      }
    }
  }
}
