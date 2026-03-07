#!/usr/bin/env node

import { Command } from 'commander';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import { BRIDGE_WS_PORT } from './types.js';
import { startDaemon } from './daemon-server.js';

function log(msg: string): void {
  process.stderr.write(msg + '\n');
}

const PLIST_LABEL = 'dev.agentdeck.daemon';
const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);

function getAgentdeckBin(): string {
  try {
    return execSync('which agentdeck', { encoding: 'utf-8' }).trim();
  } catch {
    // Fallback: resolve relative to this script
    const distDir = new URL('.', import.meta.url).pathname;
    return join(distDir, 'daemon.js');
  }
}

function buildPlist(): string {
  const bin = getAgentdeckBin();
  const logDir = join(homedir(), '.agentdeck');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${logDir}/daemon-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/daemon-stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
  </dict>
</dict>
</plist>`;
}

const program = new Command();

program
  .name('agentdeck')
  .description('AgentDeck lightweight monitoring daemon')
  .version('0.1.0');

program
  .command('start', { isDefault: true })
  .description('Start monitoring daemon (WS + mDNS + Gateway proxy)')
  .option('-p, --port <port>', 'Server port', String(BRIDGE_WS_PORT))
  .option('-d, --debug', 'Enable debug logging to /tmp/agentdeck-debug.log')
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    await startDaemon({ port, debug: opts.debug });
  });

program
  .command('status')
  .description('Show daemon status')
  .option('-p, --port <port>', 'Server port', String(BRIDGE_WS_PORT))
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    // Try all ports in range to find a running daemon
    const { listActive } = await import('./session-registry.js');
    const sessions = listActive();
    const daemon = sessions.find(s => s.agentType === 'daemon');

    const targetPort = daemon?.port ?? port;
    try {
      const res = await fetch(`http://127.0.0.1:${targetPort}/health`);
      const data = await res.json() as Record<string, unknown>;
      log(`Daemon status (port ${targetPort}): ${JSON.stringify(data, null, 2)}`);
    } catch {
      log('Daemon is not running');
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop the daemon')
  .option('-p, --port <port>', 'Server port', String(BRIDGE_WS_PORT))
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const { listActive } = await import('./session-registry.js');
    const sessions = listActive();
    const daemon = sessions.find(s => s.agentType === 'daemon');

    const targetPort = daemon?.port ?? port;
    try {
      await fetch(`http://127.0.0.1:${targetPort}/shutdown`, { method: 'POST' });
      log('Shutdown signal sent');
    } catch {
      log('Daemon is not running');
    }
  });

program
  .command('install')
  .description('Install macOS LaunchAgent for auto-start on login')
  .action(() => {
    if (process.platform !== 'darwin') {
      log('LaunchAgent is macOS-only');
      process.exit(1);
    }
    const plist = buildPlist();
    writeFileSync(PLIST_PATH, plist, 'utf-8');
    log(`Wrote ${PLIST_PATH}`);

    // Unload first if already loaded (ignore errors)
    try { execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`); } catch {}
    execSync(`launchctl load "${PLIST_PATH}"`);
    log('LaunchAgent loaded. Daemon will auto-start on login.');
  });

program
  .command('uninstall')
  .description('Remove macOS LaunchAgent')
  .action(() => {
    if (!existsSync(PLIST_PATH)) {
      log('LaunchAgent not installed');
      return;
    }
    try { execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`); } catch {}
    unlinkSync(PLIST_PATH);
    log('LaunchAgent removed.');
  });

program.parse();
