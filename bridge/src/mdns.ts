import { Bonjour } from 'bonjour-service';
import type { AgentType } from './types.js';
import { debug } from './logger.js';

let instance: Bonjour | null = null;

/**
 * Advertise this bridge session via mDNS/Bonjour so Android/LAN clients
 * can discover it automatically.
 *
 * @returns cleanup function to call on shutdown
 */
export function advertiseBridge(
  port: number,
  projectName: string,
  agentType: AgentType,
  token?: string,
): () => void {
  try {
    instance = new Bonjour();

    const txt: Record<string, string> = {
      project: projectName,
      agent: agentType,
      v: '1',
      port: String(port),
    };
    if (token) {
      txt.token = token;
    }

    const service = instance.publish({
      name: `AgentDeck-${projectName}`,
      type: 'agentdeck',
      port,
      txt,
    });

    debug('mDNS', `Published _agentdeck._tcp on port ${port} (project: ${projectName})`);

    return () => {
      try {
        service.stop?.();
        instance?.unpublishAll();
        instance?.destroy();
        instance = null;
        debug('mDNS', 'Service unpublished and destroyed');
      } catch (err) {
        debug('mDNS', `Cleanup error: ${err}`);
      }
    };
  } catch (err) {
    debug('mDNS', `Failed to advertise: ${err}`);
    // Return no-op cleanup if mDNS fails (non-critical)
    return () => {};
  }
}
