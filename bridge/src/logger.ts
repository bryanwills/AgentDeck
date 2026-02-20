import { createWriteStream, type WriteStream } from 'fs';

let debugStream: WriteStream | null = null;
let debugEnabled = false;

/**
 * Enable debug logging to a file. This avoids interfering with PTY terminal.
 * User can `tail -f /tmp/sdc-debug.log` in another terminal.
 */
export function enableDebugLog(path = '/tmp/sdc-debug.log'): void {
  debugStream = createWriteStream(path, { flags: 'w' });
  debugEnabled = true;
  debugStream.write(`[sdc] Debug log started at ${new Date().toISOString()}\n`);
}

/** Standard logging to stderr (shows in terminal alongside PTY output) */
export function log(...args: unknown[]): void {
  process.stderr.write(`[sdc] ${args.map(String).join(' ')}\n`);
}

export function logTagged(tag: string, ...args: unknown[]): void {
  process.stderr.write(`[${tag}] ${args.map(String).join(' ')}\n`);
}

/** Debug logging — only goes to file when --debug is enabled */
export function debug(tag: string, ...args: unknown[]): void {
  if (!debugEnabled || !debugStream) return;
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  debugStream.write(`${ts} [${tag}] ${args.map(String).join(' ')}\n`);
}
