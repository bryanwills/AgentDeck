import { networkInterfaces } from 'os';

/** Return the first non-internal IPv4 LAN address, or '127.0.0.1' as fallback. */
export function getLanIp(): string {
  const nets = networkInterfaces();

  // Sort interfaces: physical wired (en1, en2...) first, then en0, then other non-virtual, then virtual.
  const sortedNames = Object.keys(nets).sort((a, b) => {
    const isPhysA = /^(en|eth|wlan)\d+/i.test(a);
    const isPhysB = /^(en|eth|wlan)\d+/i.test(b);

    if (isPhysA && !isPhysB) return -1;
    if (!isPhysA && isPhysB) return 1;

    if (isPhysA && isPhysB) {
      // Prioritize en1, en2... over en0 for wired-first setups
      if (a === 'en0' && b !== 'en0') return 1;
      if (b === 'en0' && a !== 'en0') return -1;
      return a.localeCompare(b);
    }

    const isVirtA = /^(utun|bridge|vboxnet|docker|lo|gif|stf|awdl|llw|ap)\d*/i.test(a);
    const isVirtB = /^(utun|bridge|vboxnet|docker|lo|gif|stf|awdl|llw|ap)\d*/i.test(b);

    if (!isVirtA && isVirtB) return -1;
    if (isVirtA && !isVirtB) return 1;

    return a.localeCompare(b);
  });

  for (const name of sortedNames) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}
