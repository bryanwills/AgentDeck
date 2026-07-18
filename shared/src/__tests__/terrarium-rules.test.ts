// Guards the terrarium rules SSOT (terrarium-rules.ts):
//  1. the clearance invariant that motivated it (610fe15c) holds, and
//  2. the generated Swift/Kotlin/C++ mirrors on disk match what the
//     generator emits from the current source — hand edits or a skipped
//     `pnpm generate-terrarium-rules` fail here in CI.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TERRARIUM_RULES } from '../terrarium-rules.js';
import { OUTPUTS } from '../../../scripts/generate-terrarium-rules.mjs';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

describe('terrarium rules invariants', () => {
  it('floor-rest clear anchor stays left of the crayfish claws', () => {
    const { crayfish, resterMaxWidthFrac } = TERRARIUM_RULES;
    const clawLeftEdge = crayfish.homeX - crayfish.widthFrac;
    expect(crayfish.clearMaxX + resterMaxWidthFrac / 2).toBeLessThan(clawLeftEdge);
  });

  it('rest strips sit above the crayfish, below mid-water', () => {
    const { floorRestStrip, antigravityHoverStrip } = TERRARIUM_RULES;
    expect(floorRestStrip.yMin).toBeLessThan(floorRestStrip.yMax);
    expect(antigravityHoverStrip.yMax).toBeLessThan(floorRestStrip.yMin);
  });
});

describe('generated mirrors in sync', () => {
  for (const [rel, emit] of OUTPUTS) {
    it(`${rel} matches the SSOT`, () => {
      const onDisk = readFileSync(`${repoRoot}${rel}`, 'utf8');
      expect(onDisk).toBe(emit(TERRARIUM_RULES));
    });
  }
});
