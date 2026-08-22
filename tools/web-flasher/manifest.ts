/**
 * The firmware manifest the page flashes from.
 *
 * WHY THE FIRMWARE IS SERVED FROM THIS ORIGIN. GitHub Release assets carry no
 * CORS headers — measured: `curl -I -H 'Origin: https://puritysb.github.io'`
 * against both the 302 and the 200 shows no `access-control-allow-origin` on
 * either — so a browser simply cannot read them. The Pages workflow therefore
 * downloads the merged images at deploy time and lays them beside this page.
 *
 * The layout is tag-addressed:
 *
 *   fw/index.json              { "tag": "esp32-v1.0.7" }   — small, changes once per release
 *   fw/<tag>/manifest.json     the release's own manifest (schema 1)
 *   fw/<tag>/agentdeck-<board>-merged.bin
 *
 * Only `index.json` is at a stable URL, so a stale browser cache can at worst
 * point at a *previous* release's directory — never serve last release's bits
 * under this release's name.
 */

import type { BoardProfile } from "./boards";

/** One board's entry. Mirrors scripts/generate-firmware-manifest.mjs. */
export interface ManifestArtifact {
  file: string;
  size: number;
  sha256: string;
  offset: string;
}

export interface ManifestBoard
  extends Pick<
    BoardProfile,
    | "id" | "env" | "name" | "display" | "chipFamily" | "flashSize" | "flashMode"
    | "flashFreq" | "uploadBaud" | "stub" | "nativeUsb" | "ota" | "webFlash"
    | "webFlashStatus" | "webFlashVerified" | "notes"
  > {
  resetBefore: BoardProfile["before"];
  resetAfter: BoardProfile["after"];
  bootloaderOffset: string;
  merged?: ManifestArtifact;
  parts: ManifestArtifact[];
}

export interface FirmwareManifest {
  schema: number;
  release: string;
  firmwareVersion: string;
  generatedAt: string;
  offsets: Record<string, unknown>;
  boards: ManifestBoard[];
}

export const MANIFEST_SCHEMA = 1;

/** Resolved manifest plus the base URL its files hang off. */
export interface LoadedManifest {
  manifest: FirmwareManifest;
  /** e.g. "fw/esp32-v1.0.7/" — join a `file` onto this */
  base: string;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

/**
 * Load the deployed manifest. Throws with a plain-language message — the caller
 * shows it verbatim, because "no firmware is deployed" is a state a user can act
 * on (use the CLI) and a silent empty picker is not.
 */
export async function loadManifest(): Promise<LoadedManifest> {
  const index = (await getJson("fw/index.json")) as { tag?: unknown };
  const tag = typeof index.tag === "string" ? index.tag : "";
  if (!tag) throw new Error("fw/index.json names no release tag");
  const base = `fw/${tag}/`;
  const manifest = (await getJson(`${base}manifest.json`)) as FirmwareManifest;
  if (manifest.schema !== MANIFEST_SCHEMA) {
    throw new Error(
      `firmware manifest schema ${manifest.schema} — this page understands ${MANIFEST_SCHEMA}`,
    );
  }
  return { manifest, base };
}

export const manifestBoard = (m: FirmwareManifest, id: string): ManifestBoard | undefined =>
  m.boards.find((b) => b.id === id);

/** Lowercase hex sha-256 of a buffer, via SubtleCrypto (secure contexts only). */
export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fetch a board's merged image and prove it is the file the manifest describes.
 *
 * The workflow already checks this hash at deploy time; checking it again here
 * costs one pass over ~2MB and covers what the workflow cannot see — a corrupted
 * CDN response or a half-cached range. A bit-rotted image is a bricked board, so
 * the download is not "probably fine".
 */
export async function fetchMergedImage(
  loaded: LoadedManifest,
  board: ManifestBoard,
  onProgress?: (received: number, total: number) => void,
): Promise<Uint8Array> {
  const art = board.merged;
  if (!art) throw new Error(`${board.id} has no merged image in this release`);
  const url = `${loaded.base}${art.file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${art.file} → HTTP ${res.status}`);

  // Read through the stream so the UI can show progress on a slow link; a
  // 2MB silent wait reads as a hang.
  const total = art.size;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        onProgress?.(received, total);
      }
    }
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    chunks.push(buf);
    received = buf.length;
    onProgress?.(received, total);
  }

  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }

  if (out.length !== art.size) {
    throw new Error(`${art.file}: got ${out.length} bytes, manifest says ${art.size}`);
  }
  const got = await sha256Hex(out.buffer as ArrayBuffer);
  if (got !== art.sha256) {
    throw new Error(`${art.file}: sha256 ${got.slice(0, 16)}… ≠ manifest ${art.sha256.slice(0, 16)}…`);
  }
  return out;
}
