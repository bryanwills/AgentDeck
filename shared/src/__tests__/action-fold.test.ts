import { describe, expect, it } from 'vitest';
import {
  ACTION_FOLD_MAX_TOOLS,
  agentCoordinationSummary,
  foldActionCounts,
  foldToolName,
} from '../action-fold.js';

describe('agentCoordinationSummary', () => {
  it('counts dispatch and messaging tools separately', () => {
    expect(agentCoordinationSummary([
      { name: 'Agent', count: 3 },
      { name: 'Workflow', count: 1 },
      { name: 'SendMessage', count: 5 },
      { name: 'Read', count: 40 },
    ])).toEqual({ dispatches: 4, messages: 5 });
  });

  it('todo bookkeeping tools are NOT dispatch', () => {
    expect(agentCoordinationSummary([
      { name: 'TaskCreate', count: 9 },
      { name: 'TaskUpdate', count: 12 },
      { name: 'TaskList', count: 2 },
    ])).toBeNull();
  });

  it('null for a plain single-agent task', () => {
    expect(agentCoordinationSummary([{ name: 'Edit', count: 4 }])).toBeNull();
  });

  it("OpenCode's lowercase task dispatch counts", () => {
    expect(agentCoordinationSummary([{ name: 'task', count: 2 }]))
      .toEqual({ dispatches: 2, messages: 0 });
  });
});

describe('foldToolName', () => {
  it('passes plain tool names through', () => {
    expect(foldToolName('Read')).toBe('Read');
    expect(foldToolName('Bash')).toBe('Bash');
  });
  it('keeps only the tool segment of MCP names', () => {
    expect(foldToolName('mcp__claude-in-chrome__navigate')).toBe('navigate');
    expect(foldToolName('mcp__server__nested__tool')).toBe('tool');
  });
});

describe('foldActionCounts', () => {
  it('sorts by count desc and shows counts', () => {
    expect(foldActionCounts({
      tools: [
        { name: 'Edit', count: 9 },
        { name: 'Read', count: 24 },
        { name: 'Bash', count: 11 },
      ],
      filesTouched: 2,
    })).toBe('Read×24 Bash×11 Edit×9 · 2 files');
  });

  it('collapses beyond the cap into +N', () => {
    const tools = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => ({ name, count: 10 - i }));
    const line = foldActionCounts({ tools })!;
    expect(line).toBe('A×10 B×9 C×8 D×7 +2');
    expect(ACTION_FOLD_MAX_TOOLS).toBe(4);
  });

  it('merges MCP variants that fold to the same short name', () => {
    expect(foldActionCounts({
      tools: [
        { name: 'mcp__a__shot', count: 2 },
        { name: 'mcp__b__shot', count: 3 },
      ],
    })).toBe('shot×5');
  });

  it('is deterministic on ties (name order)', () => {
    const a = foldActionCounts({ tools: [{ name: 'Zed', count: 3 }, { name: 'Awk', count: 3 }] });
    const b = foldActionCounts({ tools: [{ name: 'Awk', count: 3 }, { name: 'Zed', count: 3 }] });
    expect(a).toBe('Awk×3 Zed×3');
    expect(b).toBe(a);
  });

  it('singular file label', () => {
    expect(foldActionCounts({ tools: [], filesTouched: 1 })).toBe('1 file');
  });

  it('returns null when there is nothing to say', () => {
    expect(foldActionCounts({ tools: [] })).toBeNull();
    expect(foldActionCounts({ tools: [{ name: 'Read', count: 0 }], filesTouched: 0 })).toBeNull();
  });
});
