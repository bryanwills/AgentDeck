/**
 * Scan a base directory for project directories (containing .git).
 */
import { readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

export interface ProjectEntry {
  name: string;
  path: string;
}

/**
 * Scan baseDir for subdirectories containing .git, sorted by name.
 * Expands leading ~ to home directory.
 */
export function scanProjects(baseDir = '~/github'): ProjectEntry[] {
  const resolved = baseDir.startsWith('~')
    ? join(homedir(), baseDir.slice(1))
    : baseDir;

  if (!existsSync(resolved)) return [];

  try {
    return readdirSync(resolved)
      .filter((name) => {
        if (name.startsWith('.')) return false;
        const full = join(resolved, name);
        try {
          return statSync(full).isDirectory() && existsSync(join(full, '.git'));
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, path: join(resolved, name) }));
  } catch {
    return [];
  }
}
