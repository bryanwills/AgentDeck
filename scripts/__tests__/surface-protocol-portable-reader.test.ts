import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const schema = JSON.parse(
  readFileSync(resolve(projectRoot, 'schemas/surface-protocol/v1/portable-reader.schema.json'), 'utf8'),
) as Record<string, unknown>;
const outboxRequestSchema = JSON.parse(
  readFileSync(resolve(projectRoot, 'schemas/surface-protocol/v1/portable-reader-outbox-request.schema.json'), 'utf8'),
) as Record<string, unknown>;
const outboxResponseSchema = JSON.parse(
  readFileSync(resolve(projectRoot, 'schemas/surface-protocol/v1/portable-reader-outbox-response.schema.json'), 'utf8'),
) as Record<string, unknown>;
const surfaceWelcomeSchema = JSON.parse(
  readFileSync(resolve(projectRoot, 'schemas/surface-protocol/v1/surface-welcome.schema.json'), 'utf8'),
) as Record<string, unknown>;

type JsonObject = Record<string, unknown>;

function fixture(name: string): JsonObject {
  return JSON.parse(
    readFileSync(resolve(projectRoot, `schemas/surface-protocol/v1/fixtures/portable-reader/${name}.json`), 'utf8'),
  ) as JsonObject;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('Surface Protocol portable-reader/v1 Card Feed', () => {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

  it.each(['weather-seven-day', 'unchanged'])('validates the %s fixture', (name) => {
    const value = fixture(name);
    expect(validate(value), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('carries a full seven-day future horizon with provider attribution and bounded cues', () => {
    const value = fixture('weather-seven-day');
    const weather = (value.glance as JsonObject).weather as JsonObject;
    const days = weather.days as JsonObject[];
    const cues = weather.cues as JsonObject[];
    expect(days).toHaveLength(7);
    expect((weather.validUntil as number) - (value.serverTime as number)).toBeGreaterThanOrEqual(7 * 86_400_000);
    expect(weather.source).toMatchObject({ id: 'met-no', modified: true });
    expect(cues.length).toBeLessThanOrEqual(8);
    expect((weather.rain as JsonObject).probability).toBeUndefined();

    const deliveryKeys = new Set<string>();
    for (const cue of cues) {
      const key = `${cue.id}:${cue.revision}`;
      expect(deliveryKeys.has(key)).toBe(false);
      deliveryKeys.add(key);
      expect(cue.displayAt).toBeLessThanOrEqual(cue.expiresAt);
      expect(cue.startsAt).toBeLessThanOrEqual(cue.expiresAt);
      if (cue.notifyAt !== undefined) {
        expect(cue.notifyAt).toBeGreaterThan(value.serverTime);
        expect(cue.notifyAt).toBeLessThan(cue.expiresAt);
      }
    }
  });

  it('rejects an eighth forecast day', () => {
    const value = fixture('weather-seven-day');
    const weather = (value.glance as JsonObject).weather as JsonObject;
    const days = weather.days as JsonObject[];
    days.push(clone(days[0]));
    expect(validate(value)).toBe(false);
  });

  it('rejects a cue without an expiry boundary', () => {
    const value = fixture('weather-seven-day');
    const cues = ((value.glance as JsonObject).weather as JsonObject).cues as JsonObject[];
    delete cues[0].expiresAt;
    expect(validate(value)).toBe(false);
  });

  it('rejects conditional responses that try to replace cached content', () => {
    const unchanged = fixture('unchanged');
    unchanged.glance = fixture('weather-seven-day').glance;
    expect(validate(unchanged)).toBe(false);

    const withCard = fixture('unchanged');
    (withCard.cards as JsonObject[]).push({
      cardId: 'module:nudge:test',
      actionClass: 'day',
      module: { module: 'nudge', title: 'NUDGE', question: 'Continue?' },
    });
    expect(validate(withCard)).toBe(false);
  });

  it('requires the complete OTA tuple even on an unchanged feed', () => {
    const value = fixture('unchanged');
    delete (value.fw as JsonObject).productId;
    expect(validate(value)).toBe(false);
  });

  it('allows an additive optional weather field for tolerant v1 clients', () => {
    const value = fixture('weather-seven-day');
    ((value.glance as JsonObject).weather as JsonObject).futureAdditiveField = { safelyIgnored: true };
    expect(validate(value), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});

describe('Surface Protocol portable-reader/v1 Outbox', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateRequest = ajv.compile(outboxRequestSchema);
  const validateResponse = ajv.compile(outboxResponseSchema);

  it('validates the bounded request and ordered terminal response fixtures', () => {
    const request = fixture('outbox-request');
    const response = fixture('outbox-response');
    expect(validateRequest(request), JSON.stringify(validateRequest.errors, null, 2)).toBe(true);
    expect(validateResponse(response), JSON.stringify(validateResponse.errors, null, 2)).toBe(true);

    const decisions = request.decisions as JsonObject[];
    const results = response.results as JsonObject[];
    expect(results.map((result) => result.cardId)).toEqual(decisions.map((decision) => decision.cardId));
    expect(results.map((result) => result.status)).toEqual(['applied', 'expired', 'applied']);
  });

  it('requires action correlation fields without forbidding additive metadata', () => {
    const missingChoice = fixture('outbox-request');
    delete (missingChoice.decisions as JsonObject[])[0].choiceId;
    expect(validateRequest(missingChoice)).toBe(false);

    const additive = fixture('outbox-request');
    (additive.decisions as JsonObject[])[0].futureAdditiveField = { safelyIgnored: true };
    expect(validateRequest(additive), JSON.stringify(validateRequest.errors, null, 2)).toBe(true);
  });

  it('bounds a wake-cycle batch and recognizes only v1 terminal statuses', () => {
    const oversized = fixture('outbox-request');
    const seed = (oversized.decisions as JsonObject[])[0];
    oversized.decisions = Array.from({ length: 65 }, (_, index) => ({
      ...clone(seed),
      cardId: `module:nudge:bounded:${index}`,
    }));
    expect(validateRequest(oversized)).toBe(false);

    const unknownStatus = fixture('outbox-response');
    (unknownStatus.results as JsonObject[])[0].status = 'retry_later';
    expect(validateResponse(unknownStatus)).toBe(false);
  });
});

describe('Surface Protocol negotiation fixtures', () => {
  const validateWelcome = new Ajv2020({ allErrors: true, strict: true }).compile(surfaceWelcomeSchema);

  it('validates the bounded portable welcome without advertising Inbox', () => {
    const welcome = fixture('surface-welcome');
    expect(validateWelcome(welcome), JSON.stringify(validateWelcome.errors, null, 2)).toBe(true);
    expect(welcome.capabilities).not.toContain('inbox.ws');
  });

  it('keeps public fixtures free of credentials and authorization material', () => {
    for (const name of ['weather-seven-day', 'unchanged', 'outbox-request', 'outbox-response', 'surface-welcome']) {
      const serialized = JSON.stringify(fixture(name)).toLowerCase();
      expect(serialized).not.toMatch(/pairingtoken|authorization|auth-token|machine-token|"token"|"secret"/);
    }
  });
});
