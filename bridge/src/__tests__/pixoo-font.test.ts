import { describe, expect, it } from 'vitest';
import { drawText } from '../pixoo/pixoo-font.js';

function litRows(letter: string): number[] {
  const frame = new Uint8Array(64 * 64 * 3);
  drawText(frame, 0, 0, letter, '#ffffff');
  return Array.from({ length: 5 }, (_, y) => {
    let bits = 0;
    for (let x = 0; x < 3; x++) {
      if (frame[(y * 64 + x) * 3] !== 0) bits |= 1 << (2 - x);
    }
    return bits;
  });
}

describe('Pixoo 3×5 font', () => {
  it('keeps N diagonal and visibly distinct from M', () => {
    expect(litRows('N')).toEqual([0b101, 0b110, 0b101, 0b011, 0b101]);
    expect(litRows('N')).not.toEqual(litRows('M'));
  });
});
