import { describe, it, expect, vi } from 'vitest';
import {
  parseWeatherSettings,
  wmoSummary,
  findTodayRainWindow,
  toGlanceWeather,
  buildForecastUrl,
  buildMetNoForecastUrl,
  toMetNoGlanceWeather,
  WeatherProvider,
  WEATHER_CACHE_MS,
  WEATHER_STALE_SERVE_MS,
} from '../weather.js';

const CFG = { lat: 37.57, lon: 126.98, place: 'Seoul' };
const OPEN_CFG = { ...CFG, provider: 'open-meteo' as const };
// A fixed local instant: 2026-07-31 09:30.
const NOW = new Date(2026, 6, 31, 9, 30);
const TODAY = '2026-07-31';

function hourly(entries: Array<[string, number]>) {
  return {
    time: entries.map(([t]) => t),
    precipitation_probability: entries.map(([, p]) => p),
  };
}

describe('parseWeatherSettings', () => {
  it('accepts lat/lon + optional place', () => {
    expect(parseWeatherSettings({ weather: CFG })).toEqual(CFG);
    expect(parseWeatherSettings({ weather: { lat: 1, lon: 2 } })).toEqual({ lat: 1, lon: 2 });
  });

  it('rejects missing, malformed, or out-of-range config', () => {
    expect(parseWeatherSettings({})).toBeNull();
    expect(parseWeatherSettings({ weather: { lat: 'x', lon: 1 } })).toBeNull();
    expect(parseWeatherSettings({ weather: { lat: 91, lon: 0 } })).toBeNull();
    expect(parseWeatherSettings({ weather: { lat: 0, lon: 200 } })).toBeNull();
  });

  it('keeps an explicit paid/custom Open-Meteo boundary opt-in', () => {
    const cfg = { ...OPEN_CFG, endpoint: 'https://weather.example.test/forecast', apiKey: 'secret' };
    expect(buildForecastUrl(cfg)).toMatch(/^https:\/\/weather\.example\.test\/forecast\?/);
    expect(buildForecastUrl(cfg)).toContain('apikey=secret');
  });
});

describe('wmoSummary', () => {
  it('maps representative WMO codes to short words', () => {
    expect(wmoSummary(0)).toBe('Clear');
    expect(wmoSummary(3)).toBe('Cloudy');
    expect(wmoSummary(45)).toBe('Fog');
    expect(wmoSummary(63)).toBe('Rain');
    expect(wmoSummary(75)).toBe('Snow');
    expect(wmoSummary(81)).toBe('Showers');
    expect(wmoSummary(96)).toBe('Storm');
    expect(wmoSummary(undefined)).toBe('');
  });
});

describe('findTodayRainWindow', () => {
  it('finds the first remaining contiguous window ≥ the floor with its peak', () => {
    const win = findTodayRainWindow(hourly([
      [`${TODAY}T08:00`, 80], // already past — must be ignored
      [`${TODAY}T10:00`, 10],
      [`${TODAY}T14:00`, 45],
      [`${TODAY}T15:00`, 70],
      [`${TODAY}T16:00`, 55],
      [`${TODAY}T17:00`, 5],
      [`${TODAY}T20:00`, 90], // later second window — not the first
    ]), NOW);
    expect(win).toEqual({ startHm: '14:00', endHm: '16:00', probability: 70 });
  });

  it('single qualifying hour → no endHm', () => {
    const win = findTodayRainWindow(hourly([[`${TODAY}T18:00`, 50]]), NOW);
    expect(win).toEqual({ startHm: '18:00', probability: 50 });
  });

  it('no qualifying hour today (tomorrow does not count) → undefined', () => {
    const win = findTodayRainWindow(hourly([
      [`${TODAY}T12:00`, 20],
      ['2026-08-01T09:00', 95],
    ]), NOW);
    expect(win).toBeUndefined();
  });
});

describe('toGlanceWeather', () => {
  it('rounds temps, maps codes, and carries tomorrow + rain window', () => {
    const g = toGlanceWeather({
      current: { temperature_2m: 27.6, weather_code: 61 },
      hourly: hourly([[`${TODAY}T15:00`, 65]]),
      daily: {
        time: [TODAY, '2026-08-01'],
        weather_code: [61, 0],
        temperature_2m_min: [22.4, 21.8],
        temperature_2m_max: [29.5, 31.2],
        precipitation_probability_max: [65, 10],
      },
    }, CFG, NOW);
    expect(g).toEqual({
      place: 'Seoul',
      tempC: 28,
      code: 61,
      summary: 'Rain',
      todayMinC: 22,
      todayMaxC: 30,
      rain: { startHm: '15:00', probability: 65 },
      tomorrow: { code: 0, summary: 'Clear', minC: 22, maxC: 31, rainProbability: 10 },
    });
  });
});

describe('MET Norway normalization', () => {
  it('builds seven-day offline data and precipitation cues without inventing probability', () => {
    const base = Date.UTC(2026, 6, 31, 0);
    const timeseries = Array.from({ length: 8 * 24 }, (_, i) => ({
      time: new Date(base + i * 3_600_000).toISOString(),
      data: {
        instant: { details: { air_temperature: 20 + (i % 8) } },
        next_1_hours: {
          summary: { symbol_code: i === 5 || i === 6 ? 'rain' : 'fair_day' },
          details: { precipitation_amount: i === 5 || i === 6 ? 1.2 : 0 },
        },
      },
    }));
    const raw = { properties: { meta: { updated_at: new Date(base).toISOString() }, timeseries } };
    const g = toMetNoGlanceWeather(raw, { ...CFG, timeZone: 'UTC' }, new Date(base));
    expect(g.source?.id).toBe('met-no');
    expect(g.days).toHaveLength(7);
    expect(g.validUntil).toBeGreaterThan(base + 6 * 86_400_000);
    expect(g.cues?.[0]).toMatchObject({ kind: 'precipitation.start', startsAt: base + 5 * 3_600_000 });
    expect(g.rain?.probability).toBeUndefined();
    expect(g.rain?.amountMm).toBeGreaterThan(0);
    expect(buildMetNoForecastUrl(CFG)).toContain('lat=37.570');
    const ongoing = toMetNoGlanceWeather(raw, { ...CFG, timeZone: 'UTC' }, new Date(base + 5.5 * 3_600_000));
    expect(ongoing.cues?.[0]?.notifyAt).toBeUndefined();
  });
});

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('WeatherProvider', () => {
  const RAW = { current: { temperature_2m: 20, weather_code: 0 } };

  it('unconfigured → undefined without fetching', async () => {
    const fetchImpl = vi.fn();
    const p = new WeatherProvider(fetchImpl as never);
    expect(await p.get(null)).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches once, then serves from cache inside the window', async () => {
    const fetchImpl = vi.fn(async (..._args: unknown[]) => okResponse(RAW));
    const p = new WeatherProvider(fetchImpl as never);
    const t0 = NOW.getTime();
    const a = await p.get(OPEN_CFG, t0);
    const b = await p.get(OPEN_CFG, t0 + WEATHER_CACHE_MS - 1000);
    expect(a?.tempC).toBe(20);
    expect(b).toBe(a);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(buildForecastUrl(OPEN_CFG));
  });

  it('serves the stale cache on fetch failure, up to the stale-serve bound', async () => {
    let fail = false;
    const fetchImpl = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return okResponse(RAW);
    });
    const p = new WeatherProvider(fetchImpl as never);
    const t0 = NOW.getTime();
    await p.get(OPEN_CFG, t0);
    fail = true;
    expect((await p.get(OPEN_CFG, t0 + WEATHER_CACHE_MS + 1000))?.tempC).toBe(20);
    expect(await p.get(OPEN_CFG, t0 + WEATHER_STALE_SERVE_MS + 1000)).toBeUndefined();
  });

  it('failure with no cache → undefined (never throws)', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('dns'); });
    const p = new WeatherProvider(fetchImpl as never);
    expect(await p.get(OPEN_CFG, NOW.getTime())).toBeUndefined();
  });

  it('keeps a future-bearing seven-day snapshot through a long provider outage', async () => {
    const t0 = NOW.getTime();
    const raw = {
      properties: {
        meta: { updated_at: new Date(t0).toISOString() },
        timeseries: Array.from({ length: 8 * 24 }, (_, i) => ({
          time: new Date(t0 + i * 3_600_000).toISOString(),
          data: { instant: { details: { air_temperature: 20 } },
            next_1_hours: { summary: { symbol_code: 'fair_day' }, details: { precipitation_amount: 0 } } },
        })),
      },
    };
    let fail = false;
    const fetchImpl = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return okResponse(raw);
    });
    const p = new WeatherProvider(fetchImpl as never);
    await p.get(CFG, t0);
    fail = true;
    expect((await p.get(CFG, t0 + WEATHER_STALE_SERVE_MS + 60_000))?.days).toHaveLength(7);
  });
});
