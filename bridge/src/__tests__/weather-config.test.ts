import { describe, expect, it } from 'vitest';
import {
  buildWeatherSetting,
  describeWeatherSetting,
  parseCoordinate,
  validateTimeZone,
  WeatherConfigError,
} from '../weather-config.js';

describe('weather CLI configuration', () => {
  it('rounds coordinates to the shared coarse-location boundary', () => {
    expect(parseCoordinate('37.5665', 'latitude')).toBe(37.57);
    expect(parseCoordinate('126.9780', 'longitude')).toBe(126.98);
  });

  it('rejects malformed and out-of-range coordinates', () => {
    expect(() => parseCoordinate('north', 'latitude')).toThrow(WeatherConfigError);
    expect(() => parseCoordinate('90.01', 'latitude')).toThrow(/-90 and 90/);
    expect(() => parseCoordinate('-180.01', 'longitude')).toThrow(/-180 and 180/);
  });

  it('validates IANA time zones', () => {
    expect(validateTimeZone('Asia/Seoul')).toBe('Asia/Seoul');
    expect(() => validateTimeZone('Seoul-ish')).toThrow(/valid IANA time zone/);
  });

  it('uses the host time zone and does not retain a stale place label', () => {
    expect(
      buildWeatherSetting(
        { latitude: '37.57', longitude: '126.98' },
        {
          lat: 51.5,
          lon: -0.12,
          place: 'London',
        },
        'Asia/Seoul',
      ),
    ).toEqual({ lat: 37.57, lon: 126.98, timeZone: 'Asia/Seoul' });
  });

  it('retains only an explicit custom-provider boundary when changing location', () => {
    expect(
      buildWeatherSetting(
        {
          latitude: '1',
          longitude: '2',
          place: 'Test',
          timeZone: 'UTC',
        },
        {
          provider: 'open-meteo',
          endpoint: 'https://weather.example.test/forecast',
          apiKey: 'secret',
          ignored: true,
        },
      ),
    ).toEqual({
      provider: 'open-meteo',
      endpoint: 'https://weather.example.test/forecast',
      apiKey: 'secret',
      lat: 1,
      lon: 2,
      place: 'Test',
      timeZone: 'UTC',
    });
  });

  it('renders configured and unconfigured status without exposing a custom API key', () => {
    expect(describeWeatherSetting(undefined)).toEqual(['Weather location: not configured']);
    const lines = describeWeatherSetting({
      lat: 37.57,
      lon: 126.98,
      place: 'Seoul',
      timeZone: 'Asia/Seoul',
      provider: 'open-meteo',
      apiKey: 'do-not-print',
    });
    expect(lines.join('\n')).toContain('Seoul');
    expect(lines.join('\n')).toContain('Open-Meteo');
    expect(lines.join('\n')).not.toContain('do-not-print');
  });
});
