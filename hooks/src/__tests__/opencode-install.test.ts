import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  installOpenCodeHooksIfNeeded,
  uninstallOpenCodeHooks,
  opencodePluginSource,
  opencodePluginPath,
  OPENCODE_PLUGIN_FILENAME,
} from '../opencode-install.js';

/**
 * Schema guard for the OpenCode observer plugin — the counterpart of
 * codex-install.test.ts. The plugin body is consumed by OpenCode's Bun
 * runtime and its POSTs by bridge/src/daemon-server.ts
 * `classifyObservedHookEvent`; these assertions pin the contract fields so
 * a refactor on either side fails loudly here instead of silently dropping
 * standalone OpenCode sessions from the timeline.
 */
describe('opencodePluginSource contract', () => {
  const src = opencodePluginSource();

  it('posts the four lifecycle events the daemon pipeline understands', () => {
    expect(src).toContain('opencode_session_start');
    expect(src).toContain('opencode_user_prompt_submit');
    expect(src).toContain('opencode_tool_start');
    expect(src).toContain('opencode_tool_end');
    expect(src).toContain('opencode_stop');
  });

  it('carries the payload fields the daemon reads', () => {
    // hookSid ← session_id; prompt → chat_start raw; response → chat_response.
    expect(src).toContain('session_id: sessionID');
    expect(src).toContain('prompt: prompt || ""');
    expect(src).toContain('last_assistant_message');
    expect(src).toContain('cwd');
  });

  it('self-disables inside managed agentdeck PTYs (AGENTDECK_PORT marker)', () => {
    expect(src).toContain('process.env.AGENTDECK_PORT');
    expect(src).toMatch(/if \(process\.env\.AGENTDECK_PORT\) return \{\};/);
  });

  it('resolves the daemon port from the canonical daemon.json candidates', () => {
    expect(src).toContain('.agentdeck", "daemon.json');
    expect(src).toContain('bound.serendipity.agent.deck');
    expect(src).toContain('9120');
    expect(src).toContain('/health');
  });

  it('bounds every network call (peer silence is a first-class signal)', () => {
    expect(src).toContain('AbortSignal.timeout(300)');
    expect(src).toContain('AbortSignal.timeout(800)');
  });

  it('separates user prompt parts from assistant response parts by messageID role', () => {
    expect(src).toContain('userMsgs');
    expect(src).toContain('responses.set');
  });
});

describe('installOpenCodeHooksIfNeeded', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
    delete process.env.AGENTDECK_NO_OPENCODE_HOOKS;
  });

  const tmpPluginPath = () => {
    dir = mkdtempSync(join(tmpdir(), 'agentdeck-oc-'));
    return join(dir, 'plugins', OPENCODE_PLUGIN_FILENAME);
  };

  it('writes the plugin file (creating parent dirs) and is idempotent', () => {
    const path = tmpPluginPath();
    const first = installOpenCodeHooksIfNeeded({ pluginPath: path });
    expect(first.installed).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe(opencodePluginSource());

    const mtimeBefore = statSync(path).mtimeMs;
    const second = installOpenCodeHooksIfNeeded({ pluginPath: path });
    expect(second.installed).toBe(true);
    // Content unchanged → no rewrite.
    expect(statSync(path).mtimeMs).toBe(mtimeBefore);
  });

  it('refreshes a stale or edited plugin file', () => {
    const path = tmpPluginPath();
    installOpenCodeHooksIfNeeded({ pluginPath: path });
    writeFileSync(path, '// stale v0\n', 'utf-8');
    const result = installOpenCodeHooksIfNeeded({ pluginPath: path });
    expect(result.installed).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe(opencodePluginSource());
  });

  it('honours the AGENTDECK_NO_OPENCODE_HOOKS opt-out', () => {
    process.env.AGENTDECK_NO_OPENCODE_HOOKS = '1';
    const path = tmpPluginPath();
    const result = installOpenCodeHooksIfNeeded({ pluginPath: path });
    expect(result.installed).toBe(false);
    expect(result.reason).toContain('AGENTDECK_NO_OPENCODE_HOOKS');
    expect(existsSync(path)).toBe(false);
  });

  it('uninstall removes the plugin file and is idempotent', () => {
    const path = tmpPluginPath();
    installOpenCodeHooksIfNeeded({ pluginPath: path });
    uninstallOpenCodeHooks({ pluginPath: path });
    expect(existsSync(path)).toBe(false);
    uninstallOpenCodeHooks({ pluginPath: path }); // no throw
  });

  it('default path lives under the opencode plugins dir', () => {
    expect(opencodePluginPath()).toMatch(/opencode[\\/]+plugins[\\/]+agentdeck\.js$/);
  });
});
