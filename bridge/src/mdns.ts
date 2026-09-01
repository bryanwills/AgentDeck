import Bonjour from 'bonjour-service';
import { randomUUID } from 'node:crypto';
import { hostname, networkInterfaces, userInfo } from 'node:os';
import type { AgentType } from './types.js';
import { debug, log } from './logger.js';
import {
  getLanIp,
  buildMdnsInstanceName,
  mdnsUserTag,
  sanitizeMdnsLabel,
  MDNS_TXT_SCHEMA_VERSION,
} from '@agentdeck/shared';

/**
 * True when a LAN peer could actually route to this IPv4 address.
 *
 * `bonjour-service` publishes one A record per non-internal IPv4 address it
 * finds, with no routability test (`service.js` -> `records()`). That set is
 * captured at PUBLISH time, and the daemon publishes seconds after start — so a
 * machine whose second interface is still negotiating DHCP advertises its
 * transient `169.254/16` APIPA address as a way to reach the daemon. Nothing
 * ever retracts it: the address disappears from `os.networkInterfaces()`, so no
 * later announcement carries it and no goodbye is ever sent for it, while every
 * resolver that heard it keeps handing it out.
 *
 * Measured on this repo's own fleet (2026-08-23): the advertised host resolved
 * to `192.168.68.100`, `192.168.68.60` AND `169.254.213.161` while no interface
 * on the machine held that third address. A board that picks it dials a dead
 * address at max backoff forever, and — because it never reaches the daemon —
 * leaves no trace in the daemon's log at all. That is the failure mode this
 * predicate exists to prevent, and the reason the filter belongs on the
 * PUBLISHING side: a client cannot tell a stale record from a live one.
 */
export function isRoutableIpv4(addr: string): boolean {
  // Link-local / APIPA. Self-assigned; never reachable from another host.
  if (addr.startsWith('169.254.')) return false;
  // Loopback. `internal` already covers 127.0.0.1, but an alias on a
  // non-internal interface would not be caught by that flag.
  if (addr.startsWith('127.')) return false;
  if (addr === '0.0.0.0') return false;
  return true;
}

/**
 * The IPv4 addresses this host would advertise, after the routability filter.
 *
 * This is the value the republish trigger watches. It deliberately returns the
 * whole SET rather than one address: the publisher emits an A record per
 * interface while `getLanIp()` names only the default-route one, so watching
 * `getLanIp()` alone cannot see an address appear or vanish on any OTHER
 * interface — which is exactly how the stale APIPA record above survived for
 * hours with the recovery timer running the whole time. A change detector must
 * watch what actually varies.
 */
export function advertisedIpv4Addresses(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4') continue;
      if (addr.internal || addr.mac === '00:00:00:00:00:00') continue;
      if (!isRoutableIpv4(addr.address)) continue;
      out.push(addr.address);
    }
  }
  return out.sort();
}

let instance: Bonjour | null = null;

const MDNS_RECOVERY_INTERVAL = 5_000; // 5s — tightens WiFi-change discovery gap (was 30s)

/**
 * `bonjour-service` defaults SRV/A/AAAA records to `os.hostname()`. On macOS
 * that makes its user-space responder claim the same `.local` hostname as the
 * system mDNSResponder; affected Macs interpret the duplicate claim as a remote
 * collision and permanently rename their LocalHostName on every daemon start.
 *
 * Keep the service host process-scoped instead. It only needs to remain stable
 * across this process's wake/network recovery re-publishes; clients discover
 * the service instance and resolve this SRV target immediately before connect.
 */
export const MDNS_SERVICE_HOST = `agentdeck-${randomUUID().replaceAll('-', '')}.local`;

/**
 * True if an uncaught error is a non-fatal mDNS multicast failure that should be
 * tolerated (instance invalidated + recovery timer re-publishes) rather than
 * crashing the daemon.
 *
 * `bonjour-service` performs async `send()` to the mDNS multicast group
 * (224.0.0.251:5353 / ff02::fb:5353). On network-interface changes — sleep/wake,
 * WiFi reconnect, VPN toggle, or a WSL/Hyper-V virtual interface that has no route
 * to the multicast group (Windows) — that send rejects asynchronously and surfaces
 * as an uncaughtException. None of these are recoverable by crashing.
 *
 * Covers:
 * - "already in use on the network" (duplicate service name)
 * - bind/send failures targeting the mDNS endpoint: EADDRNOTAVAIL, EHOSTUNREACH,
 *   ENETUNREACH, EHOSTDOWN, ENETDOWN, EADDRINUSE, EPERM, EACCES, ENODEV
 */
export function isNonFatalMdnsError(msg: string, code?: string): boolean {
  if (msg.includes('already in use on the network')) return true;

  // Scope socket errors to the mDNS multicast endpoint so unrelated network
  // failures (e.g. EHOSTUNREACH to a peer) still crash as before.
  const targetsMdns =
    msg.includes('5353') || msg.includes('224.0.0.251') || msg.includes('ff02::fb');
  if (!targetsMdns) return false;

  const mdnsCodes = [
    'EADDRNOTAVAIL', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN',
    'ENETDOWN', 'EADDRINUSE', 'EPERM', 'EACCES', 'ENODEV',
  ];
  return mdnsCodes.some((c) => code === c || msg.includes(c));
}

/**
 * Called from uncaughtException handler when mDNS socket fails.
 * Nulls the instance so the recovery timer knows to re-publish.
 */
export function invalidateMdnsInstance(): void {
  if (instance) {
    try {
      instance.destroy();
    } catch { /* ignore */ }
    instance = null;
    debug('mDNS', 'Instance invalidated — recovery timer will re-publish');
  }
}

/** Trigger function, set by advertiseBridge() for immediate wake recovery. */
let _triggerRecovery: (() => void) | null = null;

/**
 * Force immediate mDNS re-publish (wake recovery).
 * Bypasses the 30s recovery timer interval.
 */
export function triggerMdnsRecovery(): void {
  _triggerRecovery?.();
}

/**
 * Advertise this bridge session via mDNS/Bonjour so Android/LAN clients
 * can discover it automatically.
 *
 * Includes automatic recovery: if the underlying mDNS socket fails (e.g. after
 * sleep/wake or WiFi reconnect), a periodic check detects the broken state and
 * re-publishes the service.
 *
 * Security (issue #145): the TXT record must never carry the pairing token.
 * mDNS is multicast — a TXT token hands the credential to every device on
 * the network segment. Clients that used to self-serve it (iOS/Android
 * companions, un-provisioned ESP32 boards) pair via QR / manual URL /
 * serial provisioning instead.
 *
 * @returns cleanup function to call on shutdown
 */
export function advertiseBridge(
  port: number,
  projectName: string,
  agentType: AgentType,
): () => void {
  let stopped = false;
  let recoveryTimer: ReturnType<typeof setInterval> | null = null;
  let currentCleanup: (() => void) | null = null;

  function publish(): boolean {
    try {
      // Tear down previous instance if any
      if (instance) {
        try {
          instance.unpublishAll();
          instance.destroy();
        } catch { /* ignore cleanup errors */ }
        instance = null;
      }

      const lanIp = getLanIp();

      // Windows multi-homed egress fix: a Hyper-V/WSL host has several IPv4
      // interfaces (the real LAN adapter plus host-only virtual switches on
      // 172.x and APIPA 169.254.x). Left to its own devices, `multicast-dns`
      // joins the mDNS group on *all* of them and lets the OS pick the outbound
      // multicast interface — which can be a virtual switch, so the announcement
      // never egresses on the WiFi/LAN adapter and a remote iOS device never
      // sees the service. Pinning `interface` to the default-route LAN IP makes
      // multicast-dns bind the socket, addMembership, and setMulticastInterface
      // all to that one adapter. Gated to win32 so macOS/Linux multi-interface
      // discovery (where bonjour-service correctly fans out) is unaffected.
      // `interface` isn't on bonjour-service's ServiceConfig type but is passed
      // straight through to multicast-dns, so cast through the options object.
      const bonjourOpts =
        process.platform === 'win32' && lanIp && lanIp !== '127.0.0.1'
          ? ({ interface: lanIp } as ConstructorParameters<typeof Bonjour>[0])
          : undefined;
      instance = new Bonjour(bonjourOpts);

      // An instance name must be unique per network SEGMENT. `${project}-${port}`
      // was the same string on every machine, so an office subnet had fifty
      // daemons fighting over one name — and the conflict path here does not
      // rename, it republishes every 5s forever. Host + user + port are the
      // three ways two daemons on one segment legitimately differ.
      const shortHostname = sanitizeMdnsLabel(hostname());
      const userTag = mdnsUserTag(
        typeof process.getuid === 'function' ? process.getuid() : 0,
        userInfo().username,
      );
      const txt: Record<string, string> = {
        project: projectName,
        agent: agentType,
        // TXT schema version — keep in lockstep with the Swift daemon's
        // advertisement (apple/AgentDeck/Daemon/Server/MdnsAdvertisement.swift) so
        // clients see one contract regardless of which daemon owns the port.
        v: MDNS_TXT_SCHEMA_VERSION,
        port: String(port),
        // So a client can tell WHICH daemon this is without resolving and
        // dialling it. `user` is a hash, never the account name — multicast is
        // readable by everyone on the segment.
        host: shortHostname,
        user: userTag,
      };
      if (lanIp) txt.ip = lanIp;

      const service = instance.publish({
        name: buildMdnsInstanceName({ project: projectName, hostname: shortHostname, userTag, port }),
        host: MDNS_SERVICE_HOST,
        type: 'agentdeck',
        port,
        txt,
      });

      // Drop unroutable A records at the source. `records()` is recomputed on
      // every announce AND on the goodbye, so wrapping the instance method
      // covers both: what we never announce, we never have to retract.
      //
      // This is a wrap rather than a config flag because `bonjour-service`
      // offers none — it hard-codes "every non-internal IPv4 address" — and
      // the `interface` option below pins only the SOCKET, not the record set,
      // so even the Windows egress pin ships the bogus addresses inside the
      // packet it sends out the right adapter.
      const svc = service as unknown as { records?: () => Array<{ type?: string; data?: unknown }> };
      const baseRecords = svc.records?.bind(service);
      if (baseRecords) {
        svc.records = () => baseRecords().filter((r) => {
          if (r.type !== 'A') return true;
          return typeof r.data === 'string' && isRoutableIpv4(r.data);
        });
      }

      // Catch async publish errors — mDNS is non-critical
      service.on?.('error', (err: Error) => {
        debug('mDNS', `Service error (ignored): ${err.message}`);
      });

      debug('mDNS', `Published _agentdeck._tcp on port ${port} (project: ${projectName})`);

      currentCleanup = () => {
        try {
          service.stop?.();
          instance?.unpublishAll();
          instance?.destroy();
          instance = null;
        } catch (err) {
          debug('mDNS', `Cleanup error: ${err}`);
        }
      };

      return true;
    } catch (err) {
      debug('mDNS', `Failed to advertise: ${err}`);
      instance = null;
      currentCleanup = null;
      return false;
    }
  }

  // Track the published ADDRESS SET, not just the default-route IP. A record
  // per interface goes out, so an address appearing or vanishing on a
  // non-default interface changes what we advertise while `getLanIp()` stays
  // put — and that gap is what let a transient APIPA address stay advertised
  // for hours with this very timer running. See `advertisedIpv4Addresses`.
  let publishedIp: string | undefined;
  let publishedAddrs = '';

  function publishAndTrackIp(): boolean {
    publishedIp = getLanIp();
    publishedAddrs = advertisedIpv4Addresses().join(',');
    return publish();
  }

  // Initial publish
  publishAndTrackIp();

  // Wire immediate recovery for wake handler
  _triggerRecovery = () => {
    if (stopped) return;
    const lanIp = getLanIp();
    if (!lanIp) return;
    log('[mDNS] Wake recovery — immediate re-publish');
    invalidateMdnsInstance();
    publishAndTrackIp();
  };

  // Periodic recovery: re-publish if instance lost OR IP changed
  recoveryTimer = setInterval(() => {
    if (stopped) return;
    const lanIp = getLanIp();
    if (!lanIp) {
      debug('mDNS', 'Recovery check: no LAN IP available');
      return;
    }
    if (!instance) {
      log('[mDNS] Network recovered — re-publishing service');
      publishAndTrackIp();
    } else if (lanIp !== publishedIp) {
      log(`[mDNS] IP changed (${publishedIp} → ${lanIp}) — re-publishing service`);
      publishAndTrackIp();
    } else {
      const addrs = advertisedIpv4Addresses().join(',');
      if (addrs !== publishedAddrs) {
        log(`[mDNS] Advertised address set changed (${publishedAddrs || 'none'} → ${addrs || 'none'}) — re-publishing service`);
        publishAndTrackIp();
      }
    }
  }, MDNS_RECOVERY_INTERVAL);

  return () => {
    stopped = true;
    _triggerRecovery = null;
    if (recoveryTimer) {
      clearInterval(recoveryTimer);
      recoveryTimer = null;
    }
    currentCleanup?.();
    currentCleanup = null;
  };
}
