/**
 * Conservative predictor for "would Claude Code actually prompt the user for
 * this tool call?" — the precision guard for the observed-session PreToolUse
 * device-approval gate.
 *
 * HISTORY (why precision-first): the first PreToolUse gate held EVERY gated
 * tool call, so tools Claude auto-approves (allowlist rules, acceptEdits,
 * session "always allow") still popped Allow/Deny on devices — the reported
 * false-attention bug that got the gate removed (DEVELOPMENT_LOG 2026-05).
 * This module exists so the reinstated gate only ever holds calls we are
 * CONFIDENT Claude will prompt for. Every uncertainty resolves to "don't
 * hold": a missed hold just means the user answers in the terminal (the
 * pre-gate status quo), while a false hold nags the user with a popup Claude
 * never asked for.
 *
 * Rule semantics mirror Claude Code `permissions.allow/deny/ask` entries:
 *   "Bash"                → every Bash call
 *   "Bash(git status)"    → exact command
 *   "Bash(git status:*)"  → command prefix
 *   "Read(...)"/"WebFetch(domain:x)"/"mcp__srv__tool" → tool + spec
 * Matching is deliberately asymmetric:
 *   - allow/deny rules match LOOSELY (tool-name match with any spec counts)
 *     because a loose match only suppresses a hold (safe direction).
 *   - ask rules match STRICTLY (tool-only, or exact/prefix Bash) because an
 *     ask match *causes* a hold and must not fire on a spec we can't parse.
 */

import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { debug } from './logger.js';

export type RuleVerdict = 'allow' | 'deny' | 'ask' | 'none' | 'unknown';

interface MergedRules {
  allow: string[];
  deny: string[];
  ask: string[];
}

/** Tools that never trigger a permission prompt — holding them can only ever
 *  be a false positive. Kept intentionally tight (unknown tools are excluded
 *  by the prompt-prone check below, not this list). */
const NEVER_PROMPT_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'LS',
  'TodoWrite', 'TodoRead', 'NotebookRead',
  'Task', 'TaskOutput', 'BashOutput',
]);

/** Tools that DO prompt in default/auto permission mode unless allowlisted.
 *  Anything outside this set (including every mcp__* tool, whose per-server
 *  trust state we cannot see) is never held. */
const PROMPT_PRONE_TOOLS = new Set([
  'Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch',
]);

export function isNeverPromptTool(tool: string): boolean {
  return NEVER_PROMPT_TOOLS.has(tool);
}

export function isPromptProneTool(tool: string): boolean {
  return PROMPT_PRONE_TOOLS.has(tool);
}

interface CacheEntry {
  rules: MergedRules | null;
  loadedAt: number;
}

const RULES_CACHE_TTL_MS = 10_000;
const rulesCache = new Map<string, CacheEntry>();

/** Test seam: isolates rule loading from the developer's real ~/.claude. */
let homeOverride: string | null = null;
export function _setHomeOverrideForTests(path: string | null): void {
  homeOverride = path;
  rulesCache.clear();
}

function settingsCandidates(cwd: string | undefined): string[] {
  const home = homeOverride ?? homedir();
  const files = [
    // Enterprise managed policy (rare; parse failure here must also disable holds)
    '/Library/Application Support/ClaudeCode/managed-settings.json',
    join(home, '.claude', 'settings.json'),
    join(home, '.claude', 'settings.local.json'),
  ];
  if (cwd) {
    files.push(join(cwd, '.claude', 'settings.json'));
    files.push(join(cwd, '.claude', 'settings.local.json'));
  }
  return files;
}

/**
 * Load and merge permission rules from every settings file Claude Code reads
 * for this cwd. Returns null ("unknown") when any EXISTING file fails to
 * parse — we can no longer trust our picture of the allowlist, so the caller
 * must not hold anything.
 */
export function loadMergedPermissionRules(cwd: string | undefined): MergedRules | null {
  const key = cwd ?? '';
  const cached = rulesCache.get(key);
  if (cached && Date.now() - cached.loadedAt < RULES_CACHE_TTL_MS) return cached.rules;

  const merged: MergedRules = { allow: [], deny: [], ask: [] };
  let unknown = false;
  for (const file of settingsCandidates(cwd)) {
    let exists = false;
    try { exists = statSync(file).isFile(); } catch { exists = false; }
    if (!exists) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
      const perms = parsed?.permissions as Record<string, unknown> | undefined;
      if (perms && typeof perms === 'object') {
        for (const bucket of ['allow', 'deny', 'ask'] as const) {
          const arr = perms[bucket];
          if (Array.isArray(arr)) {
            for (const r of arr) if (typeof r === 'string') merged[bucket].push(r);
          }
        }
      }
    } catch {
      debug('permission', `settings parse failed: ${file} — disabling holds for cwd=${cwd ?? '?'}`);
      unknown = true;
      break;
    }
  }
  const rules = unknown ? null : merged;
  rulesCache.set(key, { rules, loadedAt: Date.now() });
  return rules;
}

/** Test helper. */
export function _clearRulesCache(): void {
  rulesCache.clear();
}

interface ParsedRule {
  tool: string;
  spec?: string;
}

function parseRule(rule: string): ParsedRule | null {
  const m = /^([A-Za-z][A-Za-z0-9_]*)(?:\((.*)\))?$/.exec(rule.trim());
  if (!m) return null;
  return { tool: m[1], spec: m[2] };
}

function bashSpecMatches(spec: string, command: string): boolean {
  if (spec === '*') return true;
  if (spec.endsWith(':*')) return command.startsWith(spec.slice(0, -2));
  return command === spec;
}

/** Loose match (allow/deny direction): a tool-name match with ANY spec counts,
 *  except Bash specs which we can compare precisely. */
function matchesLoose(rule: ParsedRule, tool: string, command: string | undefined): boolean {
  if (rule.tool !== tool) return false;
  if (rule.spec === undefined) return true;
  if (tool === 'Bash') {
    if (command === undefined) return true; // malformed input — assume covered
    return bashSpecMatches(rule.spec, command)
      // Compound commands: Claude prompts unless every segment is allowed; we
      // only need "might be auto-approved", so a prefix match on the first
      // segment is enough to suppress the hold.
      || bashSpecMatches(rule.spec, command.split(/&&|\|\||;|\|/)[0]?.trim() ?? command);
  }
  // Non-Bash specs (paths, domains, globs): we don't replicate the matcher —
  // any spec on the right tool MIGHT match, so treat it as covered.
  return true;
}

/** Strict match (ask direction): only patterns we can evaluate exactly. */
function matchesStrict(rule: ParsedRule, tool: string, command: string | undefined): boolean {
  if (rule.tool !== tool) return false;
  if (rule.spec === undefined) return true;
  if (tool === 'Bash' && command !== undefined) return bashSpecMatches(rule.spec, command);
  return false;
}

/**
 * Predict Claude's permission-rule verdict for a tool call.
 *   'deny'    → a deny rule may match: Claude auto-denies (or prompts) — don't hold
 *   'allow'   → an allow rule may match: Claude may auto-approve — don't hold
 *   'ask'     → an ask rule definitely matches: Claude will prompt — hold-eligible
 *   'none'    → no rule matches: default behavior for the tool applies
 *   'unknown' → settings unreadable: don't hold
 */
export function evaluatePermissionRules(
  tool: string,
  toolInput: Record<string, unknown> | undefined,
  cwd: string | undefined,
): RuleVerdict {
  const rules = loadMergedPermissionRules(cwd);
  if (rules === null) return 'unknown';
  const command = typeof toolInput?.command === 'string' ? toolInput.command : undefined;

  for (const r of rules.deny) {
    const parsed = parseRule(r);
    if (parsed && matchesLoose(parsed, tool, command)) return 'deny';
  }
  for (const r of rules.allow) {
    const parsed = parseRule(r);
    if (parsed && matchesLoose(parsed, tool, command)) return 'allow';
  }
  for (const r of rules.ask) {
    const parsed = parseRule(r);
    if (parsed && matchesStrict(parsed, tool, command)) return 'ask';
  }
  return 'none';
}
