// AgentDeck 10" — concept dataset (10 concurrent sessions across projects).
// State colors follow the product-UI bright palette (DESIGN.md §2.6 / --ui-*).
window.TEN = (function () {
  const AGENTS = {
    'claude-code': { label: 'Claude Code', short: 'Claude',   color: '#C07058', creature: 'claudecode' },
    'codex-cli':   { label: 'Codex',       short: 'Codex',    color: '#6166E0', creature: 'codex' },
    'openclaw':    { label: 'OpenClaw',     short: 'OpenClaw', color: '#FF6B5B', creature: 'openclaw' },
    'opencode':    { label: 'OpenCode',     short: 'OpenCode', color: '#9aa0a8', creature: 'opencode' },
  };

  // Status — bright product palette. Only `awaiting` animates (DESIGN §2.7).
  const STATE = {
    awaiting:   { color: '#FFA93D', label: 'Awaiting',   rank: 0 },
    error:      { color: '#FF6B6B', label: 'Failed',     rank: 1 },
    processing: { color: '#3ED6E8', label: 'Working',    rank: 2 },
    idle:       { color: '#7a8a9c', label: 'Idle',       rank: 3 },
  };

  // Weight drives the dynamic grid: attention first, then activity.
  function weight(s) {
    if (s.state === 'awaiting') return 80;
    if (s.state === 'error')    return 66;
    if (s.state === 'processing') return 30 + Math.min(20, (s.heat || 0));
    return 14; // idle shrinks to a sliver (but stays glanceable)
  }

  // size tier from weight → controls how much a cell reveals
  function tier(w) {
    if (w >= 80) return 'xl';
    if (w >= 40) return 'lg';
    if (w >= 20) return 'md';
    return 'sm';
  }

  const SESSIONS = [
    { id: 's1', agent: 'claude-code', project: 'AgentDeck',     model: 'opus-4-6',  state: 'awaiting',
      tool: 'Write · src/apme/runner.ts',
      prompt: 'Overwrite runner.ts with the refactored APME loop?',
      diff: '+142 / −58 · 3 files',
      think: 'Refactor splits the tuner loop into pure planner + executor. Needs your call before it writes.',
      elapsed: '18m', heat: 10,
      log: ['planner.ts drafted — pure, no IO', 'executor.ts drafted', 'diff staged, paused for approval'] },

    { id: 's2', agent: 'openclaw', project: 'gateway', model: 'glm-5.1', state: 'awaiting',
      tool: 'Exec · rm -rf dist && rebuild',
      prompt: 'Run destructive command  rm -rf dist  ?',
      diff: 'shell · cwd /gateway',
      think: 'Stale dist/ is shadowing the new bundle. Wants to wipe and rebuild.',
      elapsed: '1m', heat: 4,
      log: ['detected stale dist/ artifacts', 'proposes: rm -rf dist && pnpm build', 'awaiting exec approval'] },

    { id: 's3', agent: 'openclaw', project: 'apme-tuner', model: 'glm-5.1', state: 'error',
      tool: 'Bash · pnpm test',
      err: 'exit 1 · 2 specs failed',
      diff: 'tuner.spec.ts',
      think: 'Two cost-model assertions drifted after the rebase. Suggests updating snapshots.',
      elapsed: '9m', heat: 0,
      log: ['FAIL  cost-model rounds to 4dp', 'FAIL  budget guard off-by-one', 'retry? or open the diff'] },

    { id: 's4', agent: 'claude-code', project: 'gateway', model: 'opus-4-6', state: 'processing',
      tool: 'Bash · pnpm vitest run',
      diff: 'running 214 specs',
      think: 'Running the gateway integration suite end to end before the merge.',
      elapsed: '4m', heat: 18,
      log: ['✓ handshake (Ed25519)', '✓ reconnect backoff', '› exec.approval.resolve …'] },

    { id: 's5', agent: 'codex-cli', project: 'apme-tuner', model: 'gpt-5.4', state: 'processing',
      tool: 'Read · runner.ts',
      diff: 'reading 1.2k lines',
      think: 'Tracing the tuner cost model to understand the budget guard before patching.',
      elapsed: '6m', heat: 12,
      log: ['indexed runner.ts', 'mapped cost graph', '› locating budget guard'] },

    { id: 's6', agent: 'opencode', project: 'firmware-esp32', model: 'sonnet-4-5', state: 'processing',
      tool: 'Edit · main.cpp',
      diff: '+24 / −6',
      think: 'Patching the mDNS reconnect backoff so DHCP renewals rebind the socket immediately.',
      elapsed: '12m', heat: 16,
      log: ['found mdnsRefresh() guard', 'rewrote setReconnectInterval', '› compiling for ips10'] },

    { id: 's7', agent: 'codex-cli', project: 'AgentDeck', model: 'gpt-5.4', state: 'processing',
      tool: 'Grep · EinkZonePolicy',
      diff: 'scan 38 files',
      think: 'Locating every refresh-zone call site to unify them under the new policy enum.',
      elapsed: '2m', heat: 8,
      log: ['18 matches in ui/eink', '› extracting ATTENTION zone'] },

    { id: 's8', agent: 'claude-code', project: 'bridge', model: 'sonnet-4-5', state: 'idle',
      tool: null, diff: null, think: null, elapsed: '2h', heat: 0,
      log: ['session resumed', 'no active task'] },

    { id: 's9', agent: 'codex-cli', project: 'site', model: 'gpt-5.4', state: 'idle',
      tool: null, diff: null, think: null, elapsed: '3h', heat: 0,
      log: ['landing copy reviewed', 'idle'] },

    { id: 's10', agent: 'opencode', project: 'firmware-esp32', model: 'haiku-4-5', state: 'idle',
      tool: null, diff: null, think: null, elapsed: '5h', heat: 0,
      log: ['flashed ips10 build', 'idle'] },
  ];

  const RATE = {
    fiveHour: { pct: 62, resetIn: '2h 14m' },
    sevenDay: { pct: 34, resetIn: '4d 8h' },
  };

  const SERVICES = [
    { label: 'Claude',   ok: true,  detail: 'Opus·Sonnet' },
    { label: 'OpenClaw', ok: true,  detail: ':18789' },
    { label: 'MLX',      ok: true,  detail: 'local judge' },
    { label: 'Ollama',   ok: false, detail: 'stopped' },
  ];

  return { AGENTS, STATE, SESSIONS, RATE, SERVICES, weight, tier };
})();
