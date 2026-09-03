import { describe, expect, it, vi } from 'vitest';
import {
  collectNativeDependencyDiagnostic,
  formatNativeDependencyDiagnosticReport,
  isSupportedNodeMajor,
} from '../native-dependency-diagnostics.js';

const runtime = {
  executable: 'C:\\Program Files\\nodejs\\node.exe',
  node: 'v22.14.0',
  modulesAbi: '127',
  platform: 'win32' as const,
  arch: 'x64',
};

describe('native dependency diagnostics', () => {
  it('supports only the maintained even Node lines AgentDeck verifies', () => {
    expect([20, 21, 23, 25, 27].map(isSupportedNodeMajor)).toEqual([false, false, false, false, false]);
    expect([22, 24, 26].map(isSupportedNodeMajor)).toEqual([true, true, true]);
  });

  it('opens an in-memory database instead of treating require success as binding success', () => {
    const get = vi.fn(() => ({ ok: 1 }));
    const close = vi.fn();
    class FakeDatabase {
      prepare() {
        return { get };
      }
      close() {
        close();
      }
    }
    const report = collectNativeDependencyDiagnostic({
      runtime,
      load: (id) => (id.endsWith('package.json') ? { version: '12.10.0' } : FakeDatabase),
    });

    expect(report).toEqual({
      ok: true,
      runtime: { ...runtime, supported: true },
      betterSqlite3: {
        status: 'ready',
        version: '12.10.0',
        recovery: expect.stringContaining('Node 22, 24, or 26'),
      },
    });
    expect(get).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('reports a missing native binding with the exact daemon runtime identity and recovery', () => {
    const report = collectNativeDependencyDiagnostic({
      runtime,
      load: () => {
        throw new Error('Could not locate the bindings file');
      },
    });
    const text = formatNativeDependencyDiagnosticReport(report);

    expect(report.ok).toBe(false);
    expect(report.betterSqlite3.error).toContain('Could not locate the bindings file');
    expect(text).toContain('v22.14.0 (ABI 127)');
    expect(text).toContain('C:\\Program Files\\nodejs\\node.exe');
    expect(text).toContain('APME run/turn/task evaluation is disabled');
    expect(text).toContain('npx @agentdeck/setup --yes');
  });

  it('rejects Node 20 before probing a binding that may happen to exist', () => {
    const load = vi.fn();
    const report = collectNativeDependencyDiagnostic({
      runtime: { ...runtime, node: 'v20.17.0', modulesAbi: '115' },
      load,
    });

    expect(report.ok).toBe(false);
    expect(report.runtime.supported).toBe(false);
    expect(report.betterSqlite3.error).toContain('supported majors are 22, 24, and 26');
    expect(load).not.toHaveBeenCalled();
  });

  it('closes a database even when the smoke query fails', () => {
    const close = vi.fn();
    class QueryFailureDatabase {
      prepare() {
        return {
          get: () => {
            throw new Error('query failed');
          },
        };
      }
      close() {
        close();
      }
    }
    const report = collectNativeDependencyDiagnostic({ runtime, load: () => QueryFailureDatabase });

    expect(report.ok).toBe(false);
    expect(report.betterSqlite3.error).toContain('query failed');
    expect(close).toHaveBeenCalledOnce();
  });
});
