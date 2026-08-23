/**
 * The advertised A-record set must contain only addresses a LAN peer can reach,
 * and the republish trigger must notice that set changing.
 *
 * Both halves came from one measured failure (2026-08-23): the daemon's
 * advertised host resolved to two LAN addresses AND `169.254.213.161`, an APIPA
 * address no interface on the machine held any more. It was published at
 * startup, while a second interface was still negotiating DHCP, and then never
 * retracted — the recovery timer watched `getLanIp()`, which had not moved, so
 * it never republished. A board that resolves the stale record dials a dead
 * address at max backoff and, never reaching the daemon, leaves nothing in the
 * daemon's log to say so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bonjourMocks = vi.hoisted(() => {
  const publish = vi.fn();
  const unpublishAll = vi.fn();
  const destroy = vi.fn();
  return { publish, unpublishAll, destroy };
});

vi.mock('bonjour-service', () => ({
  default: class MockBonjour {
    publish = bonjourMocks.publish;
    unpublishAll = bonjourMocks.unpublishAll;
    destroy = bonjourMocks.destroy;
  },
}));

vi.mock('@agentdeck/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agentdeck/shared')>()),
  getLanIp: () => '192.0.2.10',
}));

const osMocks = vi.hoisted(() => ({ interfaces: {} as Record<string, unknown> }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    default: actual,
    networkInterfaces: () => osMocks.interfaces,
  };
});

import { advertiseBridge, advertisedIpv4Addresses, isRoutableIpv4 } from '../mdns.js';

const iface = (address: string) => ({
  address, family: 'IPv4' as const, internal: false, mac: 'aa:bb:cc:dd:ee:ff',
  netmask: '255.255.255.0', cidr: `${address}/24`,
});

describe('isRoutableIpv4', () => {
  it('rejects the addresses no LAN peer can reach', () => {
    expect(isRoutableIpv4('169.254.213.161')).toBe(false); // the measured one
    expect(isRoutableIpv4('169.254.0.1')).toBe(false);
    expect(isRoutableIpv4('127.0.0.1')).toBe(false);
    expect(isRoutableIpv4('0.0.0.0')).toBe(false);
  });

  it('keeps ordinary LAN addresses, including private ranges', () => {
    expect(isRoutableIpv4('192.168.68.100')).toBe(true);
    expect(isRoutableIpv4('192.168.68.60')).toBe(true);
    expect(isRoutableIpv4('10.1.2.3')).toBe(true);
    expect(isRoutableIpv4('172.16.4.5')).toBe(true);
    // A routable public address is still an answer, not a mistake.
    expect(isRoutableIpv4('203.0.113.9')).toBe(true);
  });
});

describe('advertisedIpv4Addresses', () => {
  it('drops link-local while keeping every real interface address', () => {
    osMocks.interfaces = {
      en0: [iface('192.168.68.100')],
      en1: [iface('192.168.68.60'), iface('169.254.213.161')],
      lo0: [{ ...iface('127.0.0.1'), internal: true }],
    };
    // Lexicographic order — the value is a stable key for change detection,
    // not a ranking, so string sort is the right (and cheapest) normalization.
    expect(advertisedIpv4Addresses()).toEqual(['192.168.68.100', '192.168.68.60']);
  });
});

describe('published A records', () => {
  // Hold the SERVICE, not its `records` function: the filter is installed by
  // wrapping that property after `publish()` returns, so a reference captured
  // inside the mock is the unwrapped original and would assert nothing.
  let service: Record<string, unknown>;
  const records = () => (service.records as () => Array<{ type?: string; data?: unknown }>)();

  beforeEach(() => {
    vi.useFakeTimers();
    bonjourMocks.publish.mockReset();
    bonjourMocks.publish.mockImplementation(() => {
      const svc: Record<string, unknown> = { on: vi.fn(), stop: vi.fn() };
      // Stand in for bonjour-service's own `records()`, which emits one A per
      // non-internal IPv4 address with no routability test.
      svc.records = () => [
        { type: 'SRV', data: {} },
        { type: 'TXT', data: {} },
        { type: 'A', data: '192.168.68.100' },
        { type: 'A', data: '192.168.68.60' },
        { type: 'A', data: '169.254.213.161' },
        { type: 'AAAA', data: 'fe80::1' },
      ];
      service = svc;
      return svc;
    });
    osMocks.interfaces = { en0: [iface('192.168.68.100')] };
  });

  afterEach(() => { vi.useRealTimers(); });

  it('filters the unroutable A record out of what is announced', () => {
    const cleanup = advertiseBridge(9120, 'AgentDeck', 'daemon');
    const emitted = records().filter((r) => r.type === 'A').map((r) => r.data);
    expect(emitted).toEqual(['192.168.68.100', '192.168.68.60']);
    expect(emitted).not.toContain('169.254.213.161');
    cleanup();
  });

  it('leaves non-A records untouched', () => {
    const cleanup = advertiseBridge(9120, 'AgentDeck', 'daemon');
    const types = records().map((r) => r.type);
    expect(types).toContain('SRV');
    expect(types).toContain('TXT');
    expect(types).toContain('AAAA');
    cleanup();
  });

  it('republishes when an address appears on a non-default interface', () => {
    // getLanIp() is pinned to 192.0.2.10 throughout, so this can only pass by
    // watching the address SET — which is the whole point of the fix.
    const cleanup = advertiseBridge(9120, 'AgentDeck', 'daemon');
    expect(bonjourMocks.publish).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6_000);
    expect(bonjourMocks.publish).toHaveBeenCalledTimes(1); // nothing moved

    osMocks.interfaces = { en0: [iface('192.168.68.100')], en1: [iface('192.168.68.60')] };
    vi.advanceTimersByTime(6_000);
    expect(bonjourMocks.publish).toHaveBeenCalledTimes(2);

    // ...and when one goes away again, which is the direction that stranded the
    // stale record: the address vanishes, so no later announce carries it and
    // no goodbye is ever sent for it.
    osMocks.interfaces = { en0: [iface('192.168.68.100')] };
    vi.advanceTimersByTime(6_000);
    expect(bonjourMocks.publish).toHaveBeenCalledTimes(3);
    cleanup();
  });

  it('does not republish for a link-local address flapping', () => {
    // It is filtered out of what we advertise, so it is not a change to it.
    const cleanup = advertiseBridge(9120, 'AgentDeck', 'daemon');
    expect(bonjourMocks.publish).toHaveBeenCalledTimes(1);
    osMocks.interfaces = { en0: [iface('192.168.68.100'), iface('169.254.9.9')] };
    vi.advanceTimersByTime(6_000);
    expect(bonjourMocks.publish).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
