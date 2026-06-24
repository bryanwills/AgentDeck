import { describe, expect, it } from 'vitest';
import { isPixooConfigReply } from '../pixoo/pixoo-discover.js';

describe('Pixoo discovery — config-reply classification', () => {
  // A real Channel/GetAllConf reply carries display config fields; the presence
  // of `Brightness` distinguishes a Pixoo from any other HTTP server on :80.
  it('accepts a real GetAllConf reply', () => {
    expect(isPixooConfigReply({ error_code: 0, Brightness: 80, RotationFlag: 1 })).toBe(true);
  });

  it('rejects a non-Pixoo HTTP/JSON response', () => {
    expect(isPixooConfigReply({ error_code: 0 })).toBe(false);
    expect(isPixooConfigReply({})).toBe(false);
    expect(isPixooConfigReply('OK')).toBe(false);
    expect(isPixooConfigReply(null)).toBe(false);
    expect(isPixooConfigReply(undefined)).toBe(false);
  });
});
