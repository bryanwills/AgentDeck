#!/usr/bin/env node

// Deterministic, privacy-safe performance harness for launch recordings.
//
// `serve` drives the real AgentDeck WebSocket contract with a looping,
// time-based three-agent scenario. `terminal` replays the matching fictional
// terminal transcript. Neither mode launches a real coding agent or touches a
// user workspace, and this file is never bundled in AgentDeck.app.

import process from 'node:process';
import { WebSocketServer } from '../bridge/node_modules/ws/wrapper.mjs';

const CYCLE_MS = 24_000;
const DEFAULT_PORT = Number(process.env.AGENTDECK_DEMO_PORT || 9220);

const phases = [
  {
    at: 0,
    focus: 'demo-claude',
    sessions: {
      claude: ['processing', 'Edit', 'Mapping the responsive dashboard'],
      codex: ['idle', undefined, 'Ready to run verification'],
      opencode: ['idle', undefined, 'Ready to prepare release notes'],
    },
    timeline: {
      agent: 'claude',
      type: 'chat_start',
      raw: 'Polish the dashboard for the launch capture',
    },
  },
  {
    at: 3_000,
    focus: 'demo-codex',
    sessions: {
      claude: ['processing', 'Edit', 'Refining the session cards'],
      codex: ['processing', 'Bash', 'Running the integration test suite'],
      opencode: ['idle', undefined, 'Ready to prepare release notes'],
    },
    timeline: {
      agent: 'codex',
      type: 'chat_start',
      raw: 'Verify the release candidate',
    },
  },
  {
    at: 6_000,
    focus: 'demo-codex',
    sessions: {
      claude: ['idle', undefined, 'Dashboard polish complete'],
      codex: ['processing', 'Test', 'Checking protocol and UI tests'],
      opencode: ['idle', undefined, 'Ready to prepare release notes'],
    },
    timeline: {
      agent: 'claude',
      type: 'chat_response',
      raw: 'Responsive dashboard polish is complete.',
    },
  },
  {
    at: 8_500,
    focus: 'demo-opencode',
    sessions: {
      claude: ['idle', undefined, 'Dashboard polish complete'],
      codex: ['processing', 'Test', 'Checking protocol and UI tests'],
      opencode: ['processing', 'Write', 'Drafting concise release notes'],
    },
    timeline: {
      agent: 'opencode',
      type: 'chat_start',
      raw: 'Draft the launch release notes',
    },
  },
  {
    at: 11_000,
    focus: 'demo-claude',
    sessions: {
      claude: [
        'awaiting_permission',
        'Edit',
        'Waiting for permission to update the interface',
        'Allow the agent to update the dashboard layout?',
      ],
      codex: ['processing', 'Test', 'Checking protocol and UI tests'],
      opencode: ['processing', 'Write', 'Drafting concise release notes'],
    },
    timeline: {
      agent: 'claude',
      type: 'chat_start',
      raw: 'Apply the final layout adjustment',
    },
  },
  {
    at: 15_000,
    focus: 'demo-claude',
    sessions: {
      claude: ['processing', 'Edit', 'Applying the approved adjustment'],
      codex: ['idle', undefined, 'All release checks passed'],
      opencode: ['idle', undefined, 'Release notes are ready'],
    },
    timeline: {
      agent: 'codex',
      type: 'chat_response',
      raw: 'All release checks passed.',
    },
  },
  {
    at: 18_500,
    focus: 'demo-claude',
    sessions: {
      claude: ['idle', undefined, 'Final adjustment complete'],
      codex: ['idle', undefined, 'All release checks passed'],
      opencode: ['idle', undefined, 'Release notes are ready'],
    },
    timeline: {
      agent: 'opencode',
      type: 'chat_response',
      raw: 'Release notes are ready for publication.',
    },
  },
];

const agents = {
  claude: {
    id: 'demo-claude',
    port: 9121,
    projectName: 'Sample Workspace',
    agentType: 'claude-code',
    modelName: 'Claude Sonnet',
    color: '\u001b[38;5;208m',
    label: 'CLAUDE CODE · Sample Workspace',
  },
  codex: {
    id: 'demo-codex',
    port: 9122,
    projectName: 'API Client',
    agentType: 'codex-cli',
    modelName: 'GPT-5 Codex',
    color: '\u001b[38;5;45m',
    label: 'CODEX · API Client',
  },
  opencode: {
    id: 'demo-opencode',
    port: 9123,
    projectName: 'Documentation',
    agentType: 'opencode',
    modelName: 'Qwen Coder',
    color: '\u001b[38;5;141m',
    label: 'OPENCODE · Documentation',
  },
};

const terminalLines = {
  claude: [
    [0, '❯ Polish the dashboard for the launch capture'],
    [900, '  Reading MonitorScreen.swift'],
    [2_100, '  Editing responsive session cards…'],
    [5_700, '✓ Dashboard polish complete'],
    [10_900, '❯ Apply the final layout adjustment'],
    [11_400, '  Permission required: update dashboard layout'],
    [14_700, '  Permission granted'],
    [15_300, '  Applying final adjustment…'],
    [18_200, '✓ Final adjustment complete'],
  ],
  codex: [
    [2_900, '› Verify the release candidate'],
    [3_600, '• Running integration test suite'],
    [6_200, '• Checking protocol contract tests'],
    [9_500, '• Checking SwiftUI state projection'],
    [14_800, '✓ 1842 tests passed'],
    [15_300, '✓ Release candidate verified'],
  ],
  opencode: [
    [8_400, '❯ Draft the launch release notes'],
    [9_100, '  Reading the release summary…'],
    [10_300, '  Writing concise feature highlights…'],
    [13_300, '  Checking names and privacy-safe examples…'],
    [14_900, '✓ Release notes are ready'],
  ],
};

function parseArgs(argv) {
  const [command = 'serve', ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--once') options.once = true;
    else if (arg === '--port') options.port = Number(rest[++index]);
    else if (arg === '--epoch-ms') options.epochMs = Number(rest[++index]);
    else if (arg === '--agent') options.agent = rest[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function cyclePosition(epochMs, now = Date.now()) {
  const elapsed = Math.max(0, now - epochMs);
  return elapsed % CYCLE_MS;
}

function phaseIndexAt(position) {
  let selected = 0;
  for (let index = 0; index < phases.length; index += 1) {
    if (phases[index].at > position) break;
    selected = index;
  }
  return selected;
}

function sessionInfo(agentKey, tuple) {
  const agent = agents[agentKey];
  const [state, currentTool, activity, question] = tuple;
  return {
    id: agent.id,
    port: agent.port,
    projectName: agent.projectName,
    agentType: agent.agentType,
    alive: true,
    state,
    modelName: agent.modelName,
    ...(currentTool ? { currentTool } : {}),
    activity,
    ...(question ? { question } : {}),
  };
}

function timelineEntry(phase, cycleStartedAt) {
  const agent = agents[phase.timeline.agent];
  return {
    ts: cycleStartedAt + phase.at,
    type: phase.timeline.type,
    raw: phase.timeline.raw,
    agentType: agent.agentType,
    projectName: agent.projectName,
    sessionId: agent.id,
  };
}

function eventsForPhase(index, cycleStartedAt, includeHistory) {
  const phase = phases[index];
  const focusedKey = Object.keys(agents).find((key) => agents[key].id === phase.focus);
  const focused = agents[focusedKey];
  const focusedTuple = phase.sessions[focusedKey];
  const [state, currentTool, , question] = focusedTuple;
  const events = [
    {
      type: 'state_update',
      state,
      permissionMode: 'default',
      sessionId: focused.id,
      focusedSessionId: focused.id,
      agentType: focused.agentType,
      projectName: focused.projectName,
      modelName: focused.modelName,
      ...(currentTool ? { currentTool } : {}),
      ...(question ? { question } : {}),
      gatewayAvailable: false,
      gatewayConnected: false,
      gatewayHasError: false,
      daemonPort: 9120,
      moduleHealth: {
        streamDeck: { available: true, connected: true, deviceCount: 1 },
        pixoo: { available: true, configuredDeviceCount: 1, connectedDeviceCount: 1 },
        esp32Wifi: {
          available: true,
          devices: [{ board: 'inkdeck', version: '0.2.3', stale: false, serialActive: false }],
        },
      },
    },
    {
      type: 'sessions_list',
      sessions: Object.entries(phase.sessions).map(([key, tuple]) => sessionInfo(key, tuple)),
    },
  ];

  if (includeHistory) {
    events.push({
      type: 'timeline_history',
      entries: phases.slice(0, index + 1).map((item) => timelineEntry(item, cycleStartedAt)),
    });
  } else {
    events.push({ type: 'timeline_event', entry: timelineEntry(phase, cycleStartedAt) });
  }
  return events;
}

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

async function serve(options) {
  const port = options.port || DEFAULT_PORT;
  const epochMs = options.epochMs || Date.now() + 1_500;
  const wss = new WebSocketServer({ host: '127.0.0.1', port });
  let lastPhase = -1;
  let lastCycle = -1;

  wss.on('connection', (socket) => {
    const now = Date.now();
    const elapsed = Math.max(0, now - epochMs);
    const cycle = Math.floor(elapsed / CYCLE_MS);
    const cycleStartedAt = epochMs + cycle * CYCLE_MS;
    const index = phaseIndexAt(cyclePosition(epochMs, now));
    send(socket, { type: 'connection', status: 'connected', sessionId: phases[index].focus });
    for (const event of eventsForPhase(index, cycleStartedAt, true)) send(socket, event);

    socket.on('message', (data) => {
      if (data.toString().includes('ping')) send(socket, { type: 'pong' });
    });
  });

  const timer = setInterval(() => {
    const now = Date.now();
    const elapsed = Math.max(0, now - epochMs);
    const cycle = Math.floor(elapsed / CYCLE_MS);
    const index = phaseIndexAt(cyclePosition(epochMs, now));
    if (index === lastPhase && cycle === lastCycle) return;

    const cycleStartedAt = epochMs + cycle * CYCLE_MS;
    const isNewCycle = cycle !== lastCycle;
    for (const socket of wss.clients) {
      for (const event of eventsForPhase(index, cycleStartedAt, isNewCycle)) send(socket, event);
    }
    lastPhase = index;
    lastCycle = cycle;

    if (options.once && index === phases.length - 1) {
      setTimeout(() => shutdown(), 1_500);
    }
  }, 100);

  const shutdown = () => {
    clearInterval(timer);
    wss.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`AgentDeck recording scenario: ws://127.0.0.1:${port}`);
  console.log(`Synchronized epoch: ${epochMs} · cycle: ${CYCLE_MS / 1000}s`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replayTerminal(options) {
  const agentKey = options.agent;
  if (!agents[agentKey]) throw new Error(`Unknown agent: ${agentKey || '(missing)'}`);

  const epochMs = options.epochMs || Date.now() + 1_000;
  const agent = agents[agentKey];
  const reset = '\u001b[0m';
  const faint = '\u001b[2m';

  for (;;) {
    const now = Date.now();
    const elapsed = Math.max(0, now - epochMs);
    const cycle = Math.floor(elapsed / CYCLE_MS);
    const cycleStartedAt = epochMs + cycle * CYCLE_MS;
    const waitForCycle = Math.max(0, cycleStartedAt - now);
    if (waitForCycle > 0) await sleep(waitForCycle);

    process.stdout.write('\u001b[2J\u001b[H');
    console.log(`${agent.color}${agent.label}${reset}`);
    console.log(`${faint}deterministic launch rehearsal · no real workspace data${reset}\n`);

    for (const [at, line] of terminalLines[agentKey]) {
      const delay = Math.max(0, cycleStartedAt + at - Date.now());
      if (delay > 0) await sleep(delay);
      console.log(line);
    }

    const cycleEndDelay = Math.max(0, cycleStartedAt + CYCLE_MS - Date.now());
    if (options.once) break;
    if (cycleEndDelay > 0) await sleep(cycleEndDelay);
  }
}

const options = parseArgs(process.argv.slice(2));
if (options.command === 'serve') await serve(options);
else if (options.command === 'terminal') await replayTerminal(options);
else throw new Error(`Unknown command: ${options.command}`);
