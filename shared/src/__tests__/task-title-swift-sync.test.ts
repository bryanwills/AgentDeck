// Drift gate for the two hand-mirrored task-naming facts in ApmeCollector.swift.
//
// The BEHAVIOR of the Swift `deriveTaskTitle` mirror is pinned by
// shared/task-title-vectors.json, which both suites replay. What the vectors
// cannot see is a CONSTANT edited on one side only: the idle-gap boundary
// (AGENT_IDLE_GAP_MS — a task-segmentation rule both daemons must enforce at
// the same instant, or `timeline.json`'s alternating owners split tasks at
// different points) and the title cap/min lengths. This gate greps the Swift
// source for the literals, so a one-sided tune goes red here in CI — the
// pairing-code / openclaw-approval sync-test pattern, minus the generator
// (recorded hand-mirror debt: fold into a generator when next touched).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AGENT_IDLE_GAP_MS } from '../eval-schema.js';
import { TASK_TITLE_MAX_CHARS, TASK_TITLE_MIN_CHARS } from '../task-title.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const swift = readFileSync(
  `${repoRoot}apple/AgentDeck/Daemon/Apme/ApmeCollector.swift`, 'utf8');

describe('ApmeCollector.swift mirrors the shared task-naming constants', () => {
  it('idle-gap boundary matches AGENT_IDLE_GAP_MS (Swift keeps seconds)', () => {
    expect(swift).toContain(`var idleGapSec: TimeInterval = ${AGENT_IDLE_GAP_MS / 1000}`);
  });

  it('title cap and minimum match the shared SSOT', () => {
    expect(swift).toContain(`let maxChars = ${TASK_TITLE_MAX_CHARS}`);
    expect(swift).toContain(`let minChars = ${TASK_TITLE_MIN_CHARS}`);
  });

  it('the Swift mirror replays the shared vector file (grep the test wiring)', () => {
    const swiftTest = readFileSync(
      `${repoRoot}apple/AgentDeckTests/ApmeTaskBoundaryTests.swift`, 'utf8');
    expect(swiftTest).toContain('shared/task-title-vectors.json');
  });
});
