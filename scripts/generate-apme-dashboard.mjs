#!/usr/bin/env node
// Sync the App-Store-bundled APME dashboard with the SSOT renderer
// (bridge/src/apme/dashboard-html.ts → apmeDashboardHtml()).
//
//   pnpm generate-apme-dashboard            rewrite the bundled resource
//   pnpm generate-apme-dashboard --check    exit 1 if the bundle drifted
//
// Requires bridge to be built first (`pnpm build`). The bundled copy at
// apple/AgentDeck/Resources/apme-dashboard.html is what the Swift daemon
// serves at GET /apme when no Node bridge has ever run on the machine
// (ApmeHttpRoutes.dashboardHtml resolution order) — before this script it was
// a hand-copied snapshot that had silently fallen a whole feature behind
// (31 KB vs 66 KB: the Work board, Tasks tab and Graph never reached App
// Store users). Drift is gated by bridge/src/__tests__/apme-dashboard-html.test.ts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUNDLED_DASHBOARD_PATH = 'apple/AgentDeck/Resources/apme-dashboard.html';

async function main() {
  let mod;
  try {
    mod = await import('../bridge/dist/apme/dashboard-html.js');
  } catch {
    console.error('bridge/dist not found — run `pnpm build` first');
    process.exit(1);
  }
  const next = mod.apmeDashboardHtml();
  const abs = path.join(projectDir, BUNDLED_DASHBOARD_PATH);
  const prev = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  const check = process.argv.includes('--check');
  if (check) {
    if (prev !== next) {
      console.error(`DRIFT: ${BUNDLED_DASHBOARD_PATH}`);
      process.exit(1);
    }
    console.log('bundled apme-dashboard.html in sync');
    return;
  }
  if (prev !== next) {
    fs.writeFileSync(abs, next);
    console.log(`wrote ${BUNDLED_DASHBOARD_PATH} (${next.length} bytes)`);
  } else {
    console.log(`up-to-date ${BUNDLED_DASHBOARD_PATH}`);
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
