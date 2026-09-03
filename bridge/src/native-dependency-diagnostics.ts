import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export const SUPPORTED_NODE_MAJORS = [22, 24, 26] as const;
export const SUPPORTED_NODE_ENGINE = '22.x || 24.x || 26.x';

interface SqliteHandle {
  prepare(sql: string): { get(): unknown };
  close(): void;
}

type BetterSqliteConstructor = new (path: string) => SqliteHandle;

export interface NativeDependencyRuntime {
  executable: string;
  node: string;
  modulesAbi: string;
  platform: NodeJS.Platform;
  arch: string;
  supported: boolean;
}

export interface BetterSqliteDiagnostic {
  status: 'ready' | 'unavailable';
  version?: string;
  error?: string;
  recovery: string;
}

export interface NativeDependencyDiagnosticReport {
  ok: boolean;
  runtime: NativeDependencyRuntime;
  betterSqlite3: BetterSqliteDiagnostic;
}

export interface NativeDependencyProbeOptions {
  load?: (id: string) => unknown;
  runtime?: Partial<Omit<NativeDependencyRuntime, 'supported'>>;
}

export function isSupportedNodeMajor(major: number): boolean {
  return (SUPPORTED_NODE_MAJORS as readonly number[]).includes(major);
}

export function collectNativeDependencyDiagnostic(
  opts: NativeDependencyProbeOptions = {},
): NativeDependencyDiagnosticReport {
  const load = opts.load ?? ((id: string) => require(id));
  const node = opts.runtime?.node ?? process.version;
  const major = Number.parseInt(node.replace(/^v/, '').split('.')[0] ?? '', 10);
  const runtime: NativeDependencyRuntime = {
    executable: opts.runtime?.executable ?? process.execPath,
    node,
    modulesAbi: opts.runtime?.modulesAbi ?? process.versions.modules,
    platform: opts.runtime?.platform ?? process.platform,
    arch: opts.runtime?.arch ?? process.arch,
    supported: isSupportedNodeMajor(major),
  };
  const recovery =
    'Re-run `npx @agentdeck/setup --yes` with Node 22, 24, or 26. ' +
    'This reinstalls the native binding and re-registers daemon autostart with the same Node runtime.';

  if (!runtime.supported) {
    return {
      ok: false,
      runtime,
      betterSqlite3: {
        status: 'unavailable',
        error: `Unsupported Node.js runtime ${runtime.node}; supported majors are 22, 24, and 26`,
        recovery,
      },
    };
  }

  let db: SqliteHandle | null = null;
  try {
    const loaded = load('better-sqlite3') as BetterSqliteConstructor | { default?: BetterSqliteConstructor };
    const Ctor = typeof loaded === 'function' ? loaded : loaded.default;
    if (!Ctor) throw new Error('module did not export a constructor');
    db = new Ctor(':memory:');
    db.prepare('SELECT 1 AS ok').get();
    let version: string | undefined;
    try {
      const pkg = load('better-sqlite3/package.json') as { version?: unknown };
      if (typeof pkg.version === 'string') version = pkg.version;
    } catch {
      // A usable binding is the contract; package metadata is diagnostic only.
    }
    return {
      ok: true,
      runtime,
      betterSqlite3: { status: 'ready', version, recovery },
    };
  } catch (err) {
    return {
      ok: false,
      runtime,
      betterSqlite3: {
        status: 'unavailable',
        error: String(err),
        recovery,
      },
    };
  } finally {
    try {
      db?.close();
    } catch {
      /* diagnostic cleanup only */
    }
  }
}

export function formatNativeDependencyDiagnosticReport(report: NativeDependencyDiagnosticReport): string {
  const lines = [
    'AgentDeck native dependency diagnostic',
    `Runtime: ${report.runtime.node} (ABI ${report.runtime.modulesAbi})`,
    `Executable: ${report.runtime.executable}`,
    `Platform: ${report.runtime.platform}-${report.runtime.arch}`,
    `Supported runtime: ${report.runtime.supported ? 'yes' : `no (${SUPPORTED_NODE_ENGINE})`}`,
  ];
  if (report.betterSqlite3.status === 'ready') {
    lines.push(`better-sqlite3: ready${report.betterSqlite3.version ? ` (${report.betterSqlite3.version})` : ''}`);
  } else {
    lines.push('better-sqlite3: unavailable — APME run/turn/task evaluation is disabled');
    if (report.betterSqlite3.error) lines.push(`Reason: ${report.betterSqlite3.error}`);
    lines.push(`Recovery: ${report.betterSqlite3.recovery}`);
  }
  return lines.join('\n');
}
