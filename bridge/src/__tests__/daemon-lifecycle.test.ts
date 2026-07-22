/**
 * Integration test: Daemon singleton guard + session registry with real file I/O.
 *
 * Uses AGENTDECK_DATA_DIR env var to isolate file operations in temp directories.
 * Tests daemon.json lifecycle, session registry, port discovery, and PID validation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { createTempDataDir, type TempDataDir } from './helpers/temp-data-dir.js';
import {
  register,
  deregister,
  listActive,
  findExistingDaemon,
  writeDaemonInfo,
  ensureDaemonInfo,
  removeDaemonInfo,
  readDaemonInfo,
  findDaemonPort,
  probeDaemonHealth,
  type SessionEntry,
  type DaemonInfo,
} from '../session-registry.js';
import { HookServer } from '../hook-server.js';

let tempDir: TempDataDir;

beforeEach(() => {
  tempDir = createTempDataDir();
});

afterEach(() => {
  tempDir.cleanup();
});

// ─── daemon.json lifecycle ──────────────────────────────────────────

describe('daemon.json lifecycle', () => {
  it('writeDaemonInfo creates daemon.json with correct content', () => {
    const info: DaemonInfo = {
      port: 9120,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };

    writeDaemonInfo(info);

    expect(existsSync(tempDir.daemonFile)).toBe(true);
    const read = JSON.parse(readFileSync(tempDir.daemonFile, 'utf-8')) as DaemonInfo;
    expect(read.port).toBe(9120);
    expect(read.pid).toBe(process.pid);
  });

  it('readDaemonInfo returns info when PID is alive', () => {
    writeDaemonInfo({ port: 9120, pid: process.pid, startedAt: new Date().toISOString() });

    const info = readDaemonInfo();
    expect(info).not.toBeNull();
    expect(info!.port).toBe(9120);
    expect(info!.pid).toBe(process.pid);
  });

  it('readDaemonInfo returns null and removes file when PID is dead', () => {
    writeDaemonInfo({ port: 9120, pid: 999999, startedAt: new Date().toISOString() });

    const info = readDaemonInfo();
    expect(info).toBeNull();
    // Stale file should be removed
    expect(existsSync(tempDir.daemonFile)).toBe(false);
  });

  it('readDaemonInfo returns null when file does not exist', () => {
    const info = readDaemonInfo();
    expect(info).toBeNull();
  });

  it('removeDaemonInfo deletes daemon.json', () => {
    writeDaemonInfo({ port: 9120, pid: process.pid, startedAt: new Date().toISOString() });
    expect(existsSync(tempDir.daemonFile)).toBe(true);

    removeDaemonInfo();
    expect(existsSync(tempDir.daemonFile)).toBe(false);
  });

  it('removeDaemonInfo is safe when file already gone', () => {
    // Should not throw
    expect(() => removeDaemonInfo()).not.toThrow();
  });

  it('self-heals daemon.json after an external deletion', () => {
    const info: DaemonInfo = {
      port: 9125,
      pid: process.pid,
      startedAt: '2026-07-22T00:00:00.000Z',
    };
    writeDaemonInfo(info);
    unlinkSync(tempDir.daemonFile);

    expect(ensureDaemonInfo(info)).toBe(true);
    expect(JSON.parse(readFileSync(tempDir.daemonFile, 'utf-8'))).toEqual(info);
  });

  it('repairs a malformed daemon.json without rewriting a healthy record', () => {
    const info: DaemonInfo = {
      port: 9121,
      pid: process.pid,
      startedAt: '2026-07-22T00:00:00.000Z',
    };
    writeFileSync(tempDir.daemonFile, '{broken', 'utf-8');

    expect(ensureDaemonInfo(info)).toBe(true);
    expect(ensureDaemonInfo(info)).toBe(false);
    expect(JSON.parse(readFileSync(tempDir.daemonFile, 'utf-8'))).toEqual(info);
  });
});

// ─── Session registry ───────────────────────────────────────────────

describe('session registry with real files', () => {
  function makeEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
    return {
      id: `test-${Math.random().toString(36).slice(2)}`,
      port: 9121,
      pid: process.pid,
      projectName: 'TestProject',
      startedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('register creates sessions.json', () => {
    const entry = makeEntry();
    register(entry);

    expect(existsSync(tempDir.sessionsFile)).toBe(true);
    const sessions = JSON.parse(readFileSync(tempDir.sessionsFile, 'utf-8'));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(entry.id);
  });

  it('register replaces existing entry with same id', () => {
    const entry = makeEntry({ port: 9121 });
    register(entry);
    register({ ...entry, port: 9122 });

    const sessions = listActive();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].port).toBe(9122);
  });

  it('deregister removes session by id', () => {
    const entry = makeEntry();
    register(entry);
    expect(listActive()).toHaveLength(1);

    deregister(entry.id);
    expect(listActive()).toHaveLength(0);
  });

  it('listActive prunes dead PIDs', () => {
    register(makeEntry({ pid: process.pid }));
    register(makeEntry({ pid: 999999, port: 9122 }));

    const active = listActive();
    expect(active).toHaveLength(1);
    expect(active[0].pid).toBe(process.pid);
  });

  it('multiple sessions coexist', () => {
    register(makeEntry({ id: 'a', port: 9121 }));
    register(makeEntry({ id: 'b', port: 9122 }));
    register(makeEntry({ id: 'c', port: 9123 }));

    expect(listActive()).toHaveLength(3);
  });

  it('findExistingDaemon returns daemon session', () => {
    register(makeEntry({ agentType: 'claude-code', port: 9121 }));
    register(makeEntry({ agentType: 'daemon', port: 9120 }));

    const daemon = findExistingDaemon();
    expect(daemon).not.toBeNull();
    expect(daemon!.agentType).toBe('daemon');
    expect(daemon!.port).toBe(9120);
  });

  it('findExistingDaemon returns null when no daemon', () => {
    register(makeEntry({ agentType: 'claude-code' }));
    expect(findExistingDaemon()).toBeNull();
  });
});

// ─── Port discovery ─────────────────────────────────────────────────

describe('findDaemonPort', () => {
  it('returns port from daemon.json (priority 1)', () => {
    writeDaemonInfo({ port: 9120, pid: process.pid, startedAt: new Date().toISOString() });

    expect(findDaemonPort()).toBe(9120);
  });

  it('falls back to sessions.json daemon entry', () => {
    register({
      id: 'daemon-1',
      port: 9125,
      pid: process.pid,
      projectName: 'daemon',
      agentType: 'daemon',
      startedAt: new Date().toISOString(),
    });

    expect(findDaemonPort()).toBe(9125);
  });

  it('returns null when no daemon anywhere', () => {
    expect(findDaemonPort()).toBeNull();
  });

  it('daemon.json takes precedence over sessions.json', () => {
    writeDaemonInfo({ port: 9120, pid: process.pid, startedAt: new Date().toISOString() });
    register({
      id: 'old-daemon',
      port: 9125,
      pid: process.pid,
      projectName: 'daemon',
      agentType: 'daemon',
      startedAt: new Date().toISOString(),
    });

    // daemon.json port should win
    expect(findDaemonPort()).toBe(9120);
  });
});

// ─── Health probe ───────────────────────────────────────────────────

describe('probeDaemonHealth', () => {
  it('returns health JSON from running server', async () => {
    const server = new HookServer();
    server.setMeta({ agentType: 'daemon', state: 'idle' });
    await server.listen(0);

    const addr = server.getServer().address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    try {
      const result = await probeDaemonHealth(port) as Record<string, unknown> | null;
      expect(result).not.toBeNull();
      expect(result!.status).toBe('ok');
      expect(result!.agentType).toBe('daemon');
    } finally {
      await server.close();
    }
  });

  it('returns null for closed port', async () => {
    const result = await probeDaemonHealth(19999);
    expect(result).toBeNull();
  });
});
