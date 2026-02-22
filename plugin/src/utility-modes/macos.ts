/**
 * macOS system control via osascript.
 * Uses execFile (no shell) for safety. Debounced execution for rapid dial rotation.
 */
import { execFile, spawn } from 'child_process';

// ---- Core executor ----

export function osascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

/**
 * Debounced osascript execution per channel key.
 * Coalesces rapid calls (e.g. fast dial rotation) — only the final value commits.
 */
const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();

export function debouncedExec(key: string, script: string, delayMs = 100): void {
  const existing = debounceMap.get(key);
  if (existing) clearTimeout(existing);
  debounceMap.set(key, setTimeout(() => {
    debounceMap.delete(key);
    osascript(script).catch(() => {});
  }, delayMs));
}

// ---- Volume ----

export interface VolumeSettings {
  outputVolume: number;
  inputVolume: number;
  outputMuted: boolean;
}

export async function getVolumeSettings(): Promise<VolumeSettings> {
  const raw = await osascript('get volume settings');
  // "output volume:65, input volume:80, alert volume:100, output muted:false"
  const num = (key: string) => {
    const re = new RegExp(`${key}:(\\d+)`);
    return parseInt(re.exec(raw)?.[1] ?? '0', 10);
  };
  return {
    outputVolume: num('output volume'),
    inputVolume: num('input volume'),
    outputMuted: /output muted:true/.test(raw),
  };
}

export function setOutputVolume(vol: number): void {
  debouncedExec('output-volume', `set volume output volume ${Math.round(vol)}`);
}

export function setOutputMuted(muted: boolean): void {
  void osascript(`set volume output muted ${muted}`).catch(() => {});
}

export function setInputVolume(vol: number): void {
  debouncedExec('input-volume', `set volume input volume ${Math.round(vol)}`);
}

// ---- Brightness ----
// Each key code press is a discrete ±1 step — no debounce (every call must fire).

export function brightnessUp(): void {
  osascript('tell application "System Events" to key code 145').catch(() => {});
}

export function brightnessDown(): void {
  osascript('tell application "System Events" to key code 144').catch(() => {});
}

// ---- Media ----

async function getRunningPlayer(): Promise<'Spotify' | 'Music' | null> {
  try {
    const result = await osascript(
      'tell application "System Events" to get name of every process whose name is "Spotify" or name is "Music"',
    );
    if (result.includes('Spotify')) return 'Spotify';
    if (result.includes('Music')) return 'Music';
  } catch { /* ignore */ }
  return null;
}

export async function mediaPlayPause(): Promise<void> {
  const player = await getRunningPlayer();
  if (player) {
    await osascript(`tell application "${player}" to playpause`);
  }
}

export async function mediaNext(): Promise<void> {
  const player = await getRunningPlayer();
  if (player) {
    await osascript(`tell application "${player}" to next track`);
  }
}

export async function mediaPrevious(): Promise<void> {
  const player = await getRunningPlayer();
  if (player) {
    await osascript(`tell application "${player}" to previous track`);
  }
}

export async function getTrackInfo(): Promise<{ name: string; artist: string; playing: boolean } | null> {
  const player = await getRunningPlayer();
  if (!player) return null;
  try {
    const name = await osascript(`tell application "${player}" to name of current track`);
    const artist = await osascript(`tell application "${player}" to artist of current track`);
    const state = await osascript(`tell application "${player}" to player state as string`);
    return { name, artist, playing: state === 'playing' };
  } catch {
    return null;
  }
}

// ---- Dark Mode ----

export async function getDarkMode(): Promise<boolean> {
  const result = await osascript(
    'tell application "System Events" to tell appearance preferences to get dark mode',
  );
  return result === 'true';
}

export async function toggleDarkMode(): Promise<boolean> {
  await osascript(
    'tell application "System Events" to tell appearance preferences to set dark mode to not dark mode',
  );
  return getDarkMode();
}

// ---- iTerm2 ----

export interface ItermSession {
  windowId: string;
  tabIndex: string;
  sessionId: string;
  name: string;
  tty: string;
}

const TMUX_PATHS = ['/usr/local/bin/tmux', '/opt/homebrew/bin/tmux', '/usr/bin/tmux'];

/** Build tty → tmux session name map from `tmux list-clients`. */
async function getTmuxSessionMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const tmuxBin of TMUX_PATHS) {
    try {
      const out = await new Promise<string>((resolve, reject) =>
        execFile(tmuxBin, ['list-clients', '-F', '#{client_tty} #{session_name}'],
          { timeout: 2000 }, (err, stdout) => err ? reject(err) : resolve(stdout.trim())),
      );
      for (const line of out.split('\n')) {
        const sp = line.indexOf(' ');
        if (sp > 0) map.set(line.slice(0, sp), line.slice(sp + 1));
      }
      break; // success
    } catch {}
  }
  return map;
}

/**
 * Derive a short, readable label from an iTerm2 session name + tty.
 *
 * Priority:
 *  1. tty matches a tmux client → "session-name" (tmux session)
 *  2. Strip leading status emoji/char, strip trailing (process), extract last path component
 */
function resolveSessionName(rawName: string, tty: string, tmuxMap: Map<string, string>): string {
  if (tty && tmuxMap.has(tty)) {
    return tmuxMap.get(tty)!;
  }
  // Strip leading non-word status chars (✳ ⠂ etc.) and trailing whitespace
  let name = rawName.replace(/^[\p{So}\p{Sm}\p{Sk}\p{Sc}\p{Ps}\p{Pe}•·⠂✳✦★☆▶◀…]+\s*/u, '').trim();
  // Strip trailing (process-name) suffix
  name = name.replace(/\s*\([^)]+\)\s*$/, '').trim();
  // If it's a path (has /), take last component
  if (name.includes('/')) {
    name = name.split('/').filter(Boolean).pop() ?? name;
  }
  return name || rawName;
}

export async function getItermSessions(): Promise<ItermSession[]> {
  try {
    const [raw, tmuxMap] = await Promise.all([
      osascript(
        'tell application "iTerm2"\n' +
        '  set sessionList to {}\n' +
        '  repeat with w in windows\n' +
        '    set wid to id of w\n' +
        '    set ti to 0\n' +
        '    repeat with t in tabs of w\n' +
        '      set ti to ti + 1\n' +
        '      repeat with s in sessions of t\n' +
        '        set ttyVal to ""\n' +
        '        try\n' +
        '          set ttyVal to tty of s as text\n' +
        '        end try\n' +
        '        set end of sessionList to (wid as text) & "|" & (ti as text) & "|" & (unique ID of s) & "|" & ttyVal & "|" & (name of s)\n' +
        '      end repeat\n' +
        '    end repeat\n' +
        '  end repeat\n' +
        '  return sessionList\n' +
        'end tell',
      ),
      getTmuxSessionMap(),
    ]);
    if (!raw) return [];
    return raw.split(', ').map(entry => {
      // Format: windowId|tabIndex|uniqueId|tty|name  (name may contain |)
      const p1 = entry.indexOf('|');
      const p2 = entry.indexOf('|', p1 + 1);
      const p3 = entry.indexOf('|', p2 + 1);
      const p4 = entry.indexOf('|', p3 + 1);
      const windowId = entry.slice(0, p1);
      const tabIndex = entry.slice(p1 + 1, p2);
      const sessionId = entry.slice(p2 + 1, p3);
      const tty = entry.slice(p3 + 1, p4);
      const rawName = entry.slice(p4 + 1);
      return { windowId, tabIndex, sessionId, name: resolveSessionName(rawName, tty, tmuxMap), tty };
    });
  } catch {
    return [];
  }
}

export async function activateItermSession(windowId: string, tabIndex: string, _sessionId: string): Promise<void> {
  await osascript(
    'tell application "iTerm2"\n' +
    '  activate\n' +
    '  repeat with w in windows\n' +
    `    if id of w is ${windowId} then\n` +
    `      select item ${tabIndex} of tabs of w\n` +
    '    end if\n' +
    '  end repeat\n' +
    'end tell',
  ).catch(() => {});
}

/** Get the tty of the active iTerm2 session (frontmost tab of frontmost window). */
export async function getActiveItermTty(): Promise<string | null> {
  try {
    const tty = await osascript(
      'tell application "iTerm2" to tty of current session of current tab of current window',
    );
    return tty || null;
  } catch {
    return null;
  }
}

/** Open a new iTerm2 tab and attach to a tmux session. */
export async function attachTmuxInIterm(sessionName: string): Promise<void> {
  await osascript(
    'tell application "iTerm2"\n' +
    '  activate\n' +
    '  tell current window\n' +
    '    set newTab to (create tab with default profile)\n' +
    `    tell current session of newTab to write text "tmux attach -t ${sessionName.replace(/"/g, '\\"')}"\n` +
    '  end tell\n' +
    'end tell',
  ).catch(() => {});
}

// ---- Clipboard Paste (STT) ----

/** Copy text to clipboard and simulate Cmd+V to paste at current cursor position. */
export function pasteText(text: string): void {
  const proc = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
  proc.stdin.write(text);
  proc.stdin.end();
  proc.on('close', () => {
    setTimeout(() => {
      osascript('tell application "System Events" to keystroke "v" using command down').catch(() => {});
    }, 50);
  });
}

// ---- Notification ----

export async function showNotification(title: string, message: string): Promise<void> {
  await osascript(
    `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}" sound name "Glass"`,
  ).catch(() => {});
}
