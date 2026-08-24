import type { WeatherSettings } from './weather.js';

export class WeatherConfigError extends Error {}

export function parseCoordinate(value: string, axis: 'latitude' | 'longitude'): number {
  const parsed = Number(value);
  const limit = axis === 'latitude' ? 90 : 180;
  if (!Number.isFinite(parsed) || parsed < -limit || parsed > limit) {
    throw new WeatherConfigError(`${axis} must be a number between -${limit} and ${limit}`);
  }
  // Forecast providers gain nothing from precise location. Two decimals are
  // roughly one kilometre and match the native app's privacy boundary.
  return Math.round(parsed * 100) / 100;
}

export function validateTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value;
  } catch {
    throw new WeatherConfigError(`"${value}" is not a valid IANA time zone (for example Asia/Seoul)`);
  }
}

export interface WeatherSetInput {
  latitude: string;
  longitude: string;
  place?: string;
  timeZone?: string;
}

/** Build the persisted weather block while retaining an explicitly configured
 * paid/custom provider boundary. `agentdeck weather set` changes location; it
 * must not silently turn an existing provider selection back into the default. */
export function buildWeatherSetting(
  input: WeatherSetInput,
  existing: Record<string, unknown> = {},
  systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
): WeatherSettings {
  const lat = parseCoordinate(input.latitude, 'latitude');
  const lon = parseCoordinate(input.longitude, 'longitude');
  const timeZone = validateTimeZone(input.timeZone ?? systemTimeZone);
  const place = input.place?.trim();
  return {
    ...(existing.provider === 'open-meteo' ? { provider: 'open-meteo' as const } : {}),
    ...(typeof existing.endpoint === 'string' ? { endpoint: existing.endpoint } : {}),
    ...(typeof existing.apiKey === 'string' ? { apiKey: existing.apiKey } : {}),
    lat,
    lon,
    ...(place ? { place } : {}),
    timeZone,
  } as WeatherSettings;
}

export function describeWeatherSetting(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['Weather location: not configured'];
  const weather = value as Record<string, unknown>;
  const lat = Number(weather.lat);
  const lon = Number(weather.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return ['Weather location: not configured'];
  return [
    `Weather location: ${lat.toFixed(2)}, ${lon.toFixed(2)}${typeof weather.place === 'string' && weather.place ? ` (${weather.place})` : ''}`,
    `Time zone: ${typeof weather.timeZone === 'string' ? weather.timeZone : '(host default)'}`,
    `Portable provider: ${weather.provider === 'open-meteo' ? 'Open-Meteo (explicit custom configuration)' : 'MET Norway (default)'}`,
  ];
}
