/**
 * Provider-neutral Glance weather — daemon-side module for the card-feed
 * sleep dashboard. The device never fetches weather itself; the daemon fetches,
 * caches, and pre-renders it into `CardFeedResponse.glance.weather`
 * (shared/src/protocol.ts § Glance).
 *
 * MET Norway Locationforecast is the zero-account default. Open-Meteo remains
 * an explicit custom-provider compatibility path; its public endpoint is not a
 * commercial-product default. Config comes from settings.json:
 *
 *   "weather": { "lat": 37.57, "lon": 126.98, "place": "Seoul" }
 *
 * No config → no weather in the glance (never a guess, never IP geolocation).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GlanceWeather, GlanceRainWindow, GlanceDayWeather, GlanceWeatherCue } from '@agentdeck/shared';
import { GLANCE_MAX_WEATHER_CUES, GLANCE_MAX_WEATHER_DAYS, GLANCE_RAIN_PROBABILITY_MIN } from '@agentdeck/shared';

export interface WeatherSettings {
  lat: number;
  lon: number;
  place?: string;
  timeZone?: string;
  provider?: 'met-no' | 'open-meteo';
  endpoint?: string;
  apiKey?: string;
}

/** Serve from cache inside this window — weather cadence is slower than the
 *  fastest pull cadence (900s), so a fresh fetch per pull would be waste. */
export const WEATHER_CACHE_MS = 30 * 60 * 1000;
/** After a fetch failure, keep serving the last good report up to this age —
 *  a flaky WAN must degrade to slightly-old weather, not a blank panel. */
export const WEATHER_STALE_SERVE_MS = 3 * 60 * 60 * 1000;
/** External peer await — timeout is first-line, not optional. */
export const WEATHER_FETCH_TIMEOUT_MS = 5000;

export function parseWeatherSettings(settings: Record<string, unknown>): WeatherSettings | null {
  const w = settings?.weather as Record<string, unknown> | undefined;
  if (!w || typeof w !== 'object') return null;
  const lat = Number(w.lat);
  const lon = Number(w.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    lat,
    lon,
    ...(typeof w.place === 'string' && w.place ? { place: w.place } : {}),
    ...(typeof w.timeZone === 'string' && validTimeZone(w.timeZone) ? { timeZone: w.timeZone } : {}),
    ...(w.provider === 'open-meteo' ? { provider: 'open-meteo' as const } : {}),
    ...(typeof w.endpoint === 'string' && w.endpoint.startsWith('https://') ? { endpoint: w.endpoint } : {}),
    ...(typeof w.apiKey === 'string' && w.apiKey ? { apiKey: w.apiKey } : {}),
  };
}

function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
}

/** WMO weather interpretation code → one short summary word. Kept ASCII so
 *  every panel font can draw it; codes ride alongside for icon-capable
 *  clients. */
export function wmoSummary(code: number | undefined): string {
  if (code === undefined || !Number.isFinite(code)) return '';
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Fair';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow';
  if (code >= 95) return 'Storm';
  return 'Cloudy';
}

/** Open-Meteo forecast subset we request (timezone=auto → local ISO times). */
interface OpenMeteoResponse {
  current?: { temperature_2m?: number; weather_code?: number };
  hourly?: { time?: string[]; precipitation_probability?: number[] };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_min?: number[];
    temperature_2m_max?: number[];
    precipitation_probability_max?: number[];
  };
}

export function buildForecastUrl(cfg: WeatherSettings): string {
  const p = new URLSearchParams({
    latitude: String(cfg.lat),
    longitude: String(cfg.lon),
    current: 'temperature_2m,weather_code',
    hourly: 'precipitation_probability',
    daily: 'weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '2',
  });
  if (cfg.apiKey) p.set('apikey', cfg.apiKey);
  return `${cfg.endpoint ?? 'https://api.open-meteo.com/v1/forecast'}?${p.toString()}`;
}

const hmOf = (iso: string): string => iso.slice(11, 16);
const dayOf = (iso: string): string => iso.slice(0, 10);

/** First remaining rain window today: contiguous hours ≥ the probability
 *  floor, starting from the current hour. */
export function findTodayRainWindow(
  hourly: { time?: string[]; precipitation_probability?: number[] } | undefined,
  now: Date,
): GlanceRainWindow | undefined {
  const times = hourly?.time ?? [];
  const probs = hourly?.precipitation_probability ?? [];
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const nowHm = `${String(now.getHours()).padStart(2, '0')}:00`;
  let start: string | undefined;
  let end: string | undefined;
  let peak = 0;
  for (let i = 0; i < times.length && i < probs.length; i++) {
    const t = times[i];
    if (dayOf(t) !== today) {
      if (start) break; // window ran to midnight
      continue;
    }
    const hm = hmOf(t);
    if (hm < nowHm) continue;
    const p = probs[i];
    if (typeof p === 'number' && p >= GLANCE_RAIN_PROBABILITY_MIN) {
      if (!start) start = hm;
      end = hm;
      if (p > peak) peak = p;
    } else if (start) {
      break; // window closed
    }
  }
  if (!start) return undefined;
  const win: GlanceRainWindow = { startHm: start, probability: Math.round(peak) };
  if (end && end !== start) win.endHm = end;
  return win;
}

export function toGlanceWeather(raw: OpenMeteoResponse, cfg: WeatherSettings, now: Date): GlanceWeather {
  const out: GlanceWeather = {};
  if (cfg.place) out.place = cfg.place;
  const cur = raw.current;
  if (cur && typeof cur.temperature_2m === 'number') out.tempC = Math.round(cur.temperature_2m);
  if (cur && typeof cur.weather_code === 'number') {
    out.code = cur.weather_code;
    out.summary = wmoSummary(cur.weather_code);
  }
  const d = raw.daily;
  if (d?.time?.length) {
    const todayMin = d.temperature_2m_min?.[0];
    const todayMax = d.temperature_2m_max?.[0];
    if (typeof todayMin === 'number') out.todayMinC = Math.round(todayMin);
    if (typeof todayMax === 'number') out.todayMaxC = Math.round(todayMax);
    if (d.time.length > 1) {
      const t: GlanceDayWeather = { summary: wmoSummary(d.weather_code?.[1]) };
      if (typeof d.weather_code?.[1] === 'number') t.code = d.weather_code[1];
      if (typeof d.temperature_2m_min?.[1] === 'number') t.minC = Math.round(d.temperature_2m_min[1]);
      if (typeof d.temperature_2m_max?.[1] === 'number') t.maxC = Math.round(d.temperature_2m_max[1]);
      if (typeof d.precipitation_probability_max?.[1] === 'number') {
        t.rainProbability = Math.round(d.precipitation_probability_max[1]);
      }
      out.tomorrow = t;
    }
  }
  const rain = findTodayRainWindow(raw.hourly, now);
  if (rain) out.rain = rain;
  return out;
}

interface MetNoPeriod {
  summary?: { symbol_code?: string };
  details?: { precipitation_amount?: number };
}
interface MetNoPoint {
  time?: string;
  data?: {
    instant?: { details?: { air_temperature?: number } };
    next_1_hours?: MetNoPeriod;
    next_6_hours?: MetNoPeriod;
  };
}
interface MetNoResponse {
  properties?: { meta?: { updated_at?: string }; timeseries?: MetNoPoint[] };
}

export function buildMetNoForecastUrl(cfg: WeatherSettings): string {
  const base = cfg.endpoint ?? 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
  const p = new URLSearchParams({
    // MET rejects more than four decimals. Three is already ~100 m.
    lat: cfg.lat.toFixed(3), lon: cfg.lon.toFixed(3),
  });
  return `${base}?${p.toString()}`;
}

const MET_SOURCE = {
  id: 'met-no', displayName: 'MET Norway',
  attributionText: 'Data from MET Norway',
  attributionUrl: 'https://api.met.no/', modified: true,
} as const;

/** Stable WMO-compatible projection used by existing icon renderers. */
export function metSymbolToWmo(symbol: string | undefined): number {
  const s = (symbol ?? '').toLowerCase();
  if (s.includes('thunder')) return 95;
  if (s.includes('snow') || s.includes('sleet')) return 75;
  if (s.includes('rainshowers')) return 81;
  if (s.includes('rain')) return 63;
  if (s.includes('fog')) return 45;
  if (s.includes('cloudy')) return 3;
  if (s.includes('partlycloudy')) return 2;
  if (s.includes('fair')) return 1;
  return 0;
}

function localParts(at: Date, timeZone?: string): { date: string; hm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hm: `${get('hour')}:${get('minute')}` };
}

function metPeriod(point: MetNoPoint): MetNoPeriod | undefined {
  return point.data?.next_1_hours ?? point.data?.next_6_hours;
}

function metIsWet(point: MetNoPoint): boolean {
  const period = metPeriod(point);
  const amount = period?.details?.precipitation_amount ?? 0;
  const symbol = period?.summary?.symbol_code ?? '';
  return amount >= 0.05 || /rain|snow|sleet/.test(symbol);
}

function cueId(kind: string, startsAt: number): string {
  return `${kind}:${new Date(startsAt).toISOString().slice(0, 13)}`;
}

export function toMetNoGlanceWeather(raw: MetNoResponse, cfg: WeatherSettings, now: Date): GlanceWeather {
  const points = (raw.properties?.timeseries ?? [])
    .filter((p): p is MetNoPoint & { time: string } => typeof p.time === 'string' && Number.isFinite(Date.parse(p.time)))
    .slice(0, 24 * GLANCE_MAX_WEATHER_DAYS + 12);
  const current = points.find((p) => Date.parse(p.time) >= now.getTime()) ?? points[0];
  const issuedAt = Date.parse(raw.properties?.meta?.updated_at ?? '') || now.getTime();
  const daysByDate = new Map<string, { temps: number[]; amount: number; symbol?: string }>();
  for (const point of points) {
    const at = new Date(point.time);
    const { date } = localParts(at, cfg.timeZone);
    let d = daysByDate.get(date);
    if (!d) { d = { temps: [], amount: 0 }; daysByDate.set(date, d); }
    const temp = point.data?.instant?.details?.air_temperature;
    if (typeof temp === 'number') d.temps.push(temp);
    const period = metPeriod(point);
    const amount = period?.details?.precipitation_amount;
    if (typeof amount === 'number') d.amount += amount;
    const symbol = period?.summary?.symbol_code;
    if (symbol && (!d.symbol || metIsWet(point))) d.symbol = symbol;
  }
  const days: GlanceDayWeather[] = Array.from(daysByDate.entries()).slice(0, GLANCE_MAX_WEATHER_DAYS).map(([date, d]) => {
    const code = metSymbolToWmo(d.symbol);
    return {
      date, code, summary: wmoSummary(code),
      ...(d.temps.length ? { minC: Math.round(Math.min(...d.temps)), maxC: Math.round(Math.max(...d.temps)) } : {}),
      ...(d.amount > 0 ? { precipitationMm: Math.round(d.amount * 10) / 10 } : {}),
    };
  });

  const cues: GlanceWeatherCue[] = [];
  let i = 0;
  while (i < points.length && cues.length < GLANCE_MAX_WEATHER_CUES) {
    if (!metIsWet(points[i]!)) { i++; continue; }
    const start = Date.parse(points[i]!.time);
    let end = start + 60 * 60 * 1000;
    let amount = 0;
    let snow = false;
    while (i < points.length && metIsWet(points[i]!)) {
      const p = points[i]!;
      amount += metPeriod(p)?.details?.precipitation_amount ?? 0;
      snow ||= /snow|sleet/.test(metPeriod(p)?.summary?.symbol_code ?? '');
      end = Date.parse(p.time) + 60 * 60 * 1000;
      i++;
    }
    if (end <= now.getTime()) continue;
    const kind = snow ? 'snow.start' : 'precipitation.start';
    const hm = localParts(new Date(start), cfg.timeZone).hm;
    const notifyAt = start - 30 * 60 * 1000;
    cues.push({
      id: cueId(kind, start), revision: 1, kind,
      severity: amount >= 5 ? 'warning' : 'notice',
      displayAt: Math.max(issuedAt, start - 3 * 60 * 60 * 1000),
      ...(notifyAt > now.getTime() ? { notifyAt } : {}),
      startsAt: start, endsAt: end, expiresAt: end,
      title: `${snow ? 'Snow' : 'Rain'} around ${hm}`,
      detail: amount > 0 ? `${Math.round(amount * 10) / 10} mm forecast` : undefined,
    });
  }

  const curTemp = current?.data?.instant?.details?.air_temperature;
  const curCode = metSymbolToWmo(metPeriod(current ?? {})?.summary?.symbol_code);
  const out: GlanceWeather = {
    ...(cfg.place ? { place: cfg.place } : {}),
    ...(typeof curTemp === 'number' ? { tempC: Math.round(curTemp) } : {}),
    code: curCode, summary: wmoSummary(curCode), issuedAt,
    validUntil: points.length ? Date.parse(points[points.length - 1]!.time) + 60 * 60 * 1000 : issuedAt,
    ...(cfg.timeZone ? { timeZone: cfg.timeZone } : {}), source: MET_SOURCE,
    days, ...(cues.length ? { cues } : {}),
  };
  if (days[0]) { out.todayMinC = days[0].minC; out.todayMaxC = days[0].maxC; }
  if (days[1]) out.tomorrow = days[1];
  const firstWet = cues[0];
  if (firstWet) {
    const start = localParts(new Date(firstWet.startsAt), cfg.timeZone).hm;
    const end = firstWet.endsAt ? localParts(new Date(firstWet.endsAt), cfg.timeZone).hm : undefined;
    out.rain = { startHm: start, ...(end ? { endHm: end } : {}),
      ...(days[0]?.precipitationMm !== undefined ? { amountMm: days[0].precipitationMm } : {}) };
  }
  return out;
}

interface CacheEntry {
  key: string;
  at: number;
  refreshAt?: number;
  lastModified?: string;
  data: GlanceWeather;
}

export class WeatherProvider {
  private cache: CacheEntry | null = null;
  private inflight: Promise<GlanceWeather | undefined> | null = null;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly log: (msg: string) => void = () => {},
    private readonly cachePath?: string,
  ) { this.loadCache(); }

  /** Current weather for `cfg`, from cache when fresh. Resolves `undefined`
   *  when unconfigured or when no report (fresh or stale-servable) exists —
   *  the glance simply omits weather. Never throws. */
  async get(cfg: WeatherSettings | null, now: number = Date.now()): Promise<GlanceWeather | undefined> {
    if (!cfg) return undefined;
    const key = `${cfg.provider ?? 'met-no'}:${cfg.lat.toFixed(3)},${cfg.lon.toFixed(3)}:${cfg.timeZone ?? ''}`;
    const cached = this.cache;
    if (cached && cached.key === key && now < (cached.refreshAt ?? cached.at + WEATHER_CACHE_MS)) return cached.data;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchFresh(cfg, key, now).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async fetchFresh(cfg: WeatherSettings, key: string, now: number): Promise<GlanceWeather | undefined> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), WEATHER_FETCH_TIMEOUT_MS);
    try {
      const met = (cfg.provider ?? 'met-no') === 'met-no';
      const headers: Record<string, string> = met
        ? { 'User-Agent': 'AgentDeck/1.0 (+https://github.com/puritysb/AgentDeck)', Accept: 'application/json' }
        : {};
      if (met && this.cache?.key === key && this.cache.lastModified) headers['If-Modified-Since'] = this.cache.lastModified;
      const res = await this.fetchImpl(met ? buildMetNoForecastUrl(cfg) : buildForecastUrl(cfg), { signal: ctl.signal, headers });
      if (res.status === 304 && this.cache?.key === key) {
        this.cache.refreshAt = now + WEATHER_CACHE_MS; this.persistCache(); return this.cache.data;
      }
      if (!res.ok) throw new Error(`${met ? 'met-no' : 'open-meteo'} HTTP ${res.status}`);
      const raw = await res.json();
      const data = met ? toMetNoGlanceWeather(raw as MetNoResponse, cfg, new Date(now))
        : toGlanceWeather(raw as OpenMeteoResponse, cfg, new Date(now));
      const expires = Date.parse(res.headers?.get?.('expires') ?? '');
      this.cache = { key, at: now, refreshAt: Number.isFinite(expires) ? Math.max(now, expires) : now + WEATHER_CACHE_MS,
        lastModified: res.headers?.get?.('last-modified') ?? undefined, data };
      this.persistCache();
      return data;
    } catch (err) {
      this.log(`[weather] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      const cached = this.cache;
      if (cached && cached.key === key) {
        const forecastStillUseful = typeof cached.data.validUntil === 'number' && now < cached.data.validUntil;
        if (now - cached.at < WEATHER_STALE_SERVE_MS || forecastStillUseful) return cached.data;
      }
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  private loadCache(): void {
    if (!this.cachePath) return;
    try {
      const parsed = JSON.parse(readFileSync(this.cachePath, 'utf8')) as CacheEntry;
      if (parsed && typeof parsed.key === 'string' && typeof parsed.at === 'number' && parsed.data) this.cache = parsed;
    } catch { /* first run or corrupt cache: fetch normally */ }
  }

  private persistCache(): void {
    if (!this.cachePath || !this.cache) return;
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true });
      const tmp = `${this.cachePath}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(this.cache)); renameSync(tmp, this.cachePath);
    } catch (err) { this.log(`[weather] cache persist failed: ${err instanceof Error ? err.message : String(err)}`); }
  }
}
