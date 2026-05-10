import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Keep test runs hermetic. Several modules discover a live AgentDeck daemon by
// reading AGENTDECK_DATA_DIR plus App Store container fallbacks; using a temp
// data dir prevents local app state from affecting Vitest.
const dataDir = mkdtempSync(join(tmpdir(), 'agentdeck-vitest-'));
process.env.AGENTDECK_DATA_DIR = dataDir;

process.once('exit', () => {
  rmSync(dataDir, { recursive: true, force: true });
});
