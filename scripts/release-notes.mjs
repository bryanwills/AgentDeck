#!/usr/bin/env node
// Render a GitHub Release body for a delivery tag.
//
// A release body is two halves that answer different questions, and only one of
// them is worth writing twice. "How do I install this?" is the same paragraph
// every time and lives in .github/release-notes/<channel>.md. "What changed?" is
// the reason anyone opens a release page at all, and it lives in CHANGELOG.md —
// which is where it was already being written, and where it stayed, because
// every release workflow hardcoded a static body and no channel's notes ever
// carried a single line of it.
//
//   node scripts/release-notes.mjs npm-v1.0.21                    # body on stdout
//   node scripts/release-notes.mjs esp32-v1.0.5 --template x.md   # override the tail
//   node scripts/release-notes.mjs npm-v1.0.21 --check            # entry exists?
//
// Exits non-zero when the tag has no CHANGELOG section, so a release cannot be
// cut without one. --check is the same lookup with no rendering, for the
// pre-flight gate in verify-release-version.mjs.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The tag prefix is the channel id; the label is how the channel is spelled in
// a heading and a release title. Keep in step with RELEASING.md's tag list.
const CHANNELS = {
  npm: 'npm',
  apple: 'Apple',
  android: 'Android',
  streamdeck: 'Stream Deck',
  ulanzi: 'Ulanzi',
  esp32: 'ESP32',
};

export function parseTag(tag) {
  const match = /^([a-z0-9]+)-v(\d+\.\d+\.\d+)$/.exec(tag ?? '');
  if (!match) {
    throw new Error(`not a delivery tag: ${tag} (expected <channel>-v<X.Y.Z>)`);
  }
  const [, channel, version] = match;
  const label = CHANNELS[channel];
  if (!label) {
    throw new Error(`unknown channel "${channel}" — known: ${Object.keys(CHANNELS).join(', ')}`);
  }
  return { channel, version, label };
}

/**
 * Find a tag's section in the changelog.
 *
 * A heading matches when it names this channel AND this version anywhere in the
 * line, so both shapes work: a single-channel patch
 * (`## 2026-08-14 — npm 1.0.20`) and a round cut across several channels at
 * once (`## 2026-08-18 — npm 1.0.21 · Apple 1.0.7 · Android 1.0.10 · …`), which
 * is what a simultaneous cut actually is and what its notes should say.
 *
 * There is deliberately no fallback to a bare `## 1.0.7`. The channels stopped
 * sharing a patch number, so a bare heading now collides: `## 1.0.7` was npm's
 * on 2026-08-06 and Apple reached 1.0.7 on 2026-08-18 with entirely different
 * content. Emitting one channel's notes under another channel's tag is worse
 * than emitting none, so a legacy section is simply not looked up.
 */
export function findEntry(markdown, { version, label }) {
  const lines = markdown.split('\n');
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // (?![\d.]) so 1.0.2 does not match inside 1.0.21.
  const scoped = new RegExp(`^##\\s.*\\b${escape(label)}\\s+${escape(version)}(?![\\d.])`, 'i');

  const start = lines.findIndex((line) => scoped.test(line));
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return {
    heading: lines[start],
    body: lines.slice(start + 1, end).join('\n').trim(),
  };
}

function render(tag, templateOverride) {
  const { channel, version, label } = parseTag(tag);
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const entry = findEntry(changelog, { version, label });
  if (!entry) {
    throw new Error(
      `CHANGELOG.md has no entry for ${tag}.\n` +
        `Add a "## <YYYY-MM-DD> — ${label} ${version}" section before cutting the tag ` +
        `(see RELEASING.md).`,
    );
  }

  const parts = [`## AgentDeck ${label} v${version}`, ''];
  if (entry.body) parts.push(entry.body, '');

  // ESP32's tail is a board table rendered from the artifacts that actually
  // built, so it cannot be a checked-in file — that workflow writes it and
  // passes it in. Every other channel's tail is the same text every release.
  const template = templateOverride ?? join(ROOT, '.github/release-notes', `${channel}.md`);
  if (existsSync(template)) {
    parts.push(readFileSync(template, 'utf8').trim(), '');
  }
  parts.push(
    `Full changelog: https://github.com/puritysb/AgentDeck/blob/${tag}/CHANGELOG.md`,
    '',
  );
  return parts.join('\n');
}

const [tag, ...rest] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (rest.includes('--check')) {
      const { version, label } = parseTag(tag);
      const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
      if (!findEntry(changelog, { version, label })) {
        throw new Error(
          `CHANGELOG.md has no entry for ${tag} — add "## <YYYY-MM-DD> — ${label} ${version}".`,
        );
      }
    } else {
      const at = rest.indexOf('--template');
      const templateOverride = at === -1 ? undefined : rest[at + 1];
      if (at !== -1 && !templateOverride) throw new Error('--template needs a path');
      process.stdout.write(render(tag, templateOverride));
    }
  } catch (error) {
    console.error(`release-notes: ${error.message}`);
    process.exit(1);
  }
}
