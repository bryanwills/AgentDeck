#!/usr/bin/env node

import { Command } from 'commander';
import { BRIDGE_WS_PORT } from './types.js';
import { startDaemon } from './daemon-server.js';

function log(msg: string): void {
  process.stderr.write(msg + '\n');
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

program.parse();
