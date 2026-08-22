import "../../design/tokens.css";
import "./style.css";
import { BOARDS, boardById, type BoardProfile } from "./boards";
import {
  fetchMergedImage,
  loadManifest,
  manifestBoard,
  type LoadedManifest,
  type ManifestBoard,
} from "./manifest";
import { connectAndIdentify, finish, writeMerged, type FlashSession } from "./flash";
import {
  LOCALES,
  currentLocale,
  readStoredLocale,
  setLocale,
  storeLocale,
  t,
  type Locale,
  type MessageKey,
} from "./i18n";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);

/* ---------------------------------------------------------------- browser gate
   Web Serial is Chrome/Edge desktop only. Checked before the flow renders and
   the flow is REPLACED, not annotated — a toast above a working-looking form
   invites the user to try anyway and fail at the port picker. */
function browserBlocker(): MessageKey | null {
  // Read the UA up front: `"serial" in navigator` narrows `navigator` to `never`
  // in the else branch once the w3c-web-serial types are loaded.
  const ua = navigator.userAgent;
  if (!window.isSecureContext) return "why.insecure";
  if (!("serial" in navigator)) {
    if (/Firefox\//.test(ua)) return "why.firefox";
    if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return "why.safari";
    if (/Android|iPhone|iPad/.test(ua)) return "why.mobile";
    return "why.other";
  }
  return null;
}

/* ------------------------------------------------------------------- state */
let loaded: LoadedManifest | null = null;
let session: FlashSession | null = null;
/**
 * The board the live `session` belongs to — NOT whatever the <select> shows.
 * By the time the change handler runs, the element already reads the new value,
 * so releasing the old session by reading the picker would apply the wrong
 * board's `after` reset mode to it.
 */
let current: BoardProfile | null = null;
let image: Uint8Array | null = null;
const logLines: string[] = [];

function log(line: string) {
  logLines.push(line);
  $("raw").textContent = logLines.join("");
}

/* --------------------------------------------------------------- rendering */

/** A board's own reason for being offered, or not. */
function offeredIn(m: LoadedManifest | null, b: BoardProfile): ManifestBoard | undefined {
  if (!m) return undefined;
  const entry = manifestBoard(m.manifest, b.id);
  return entry?.webFlash && entry.merged ? entry : undefined;
}

function renderBoardOptions() {
  const sel = $<HTMLSelectElement>("board");
  const keep = sel.value;
  sel.innerHTML = "";
  for (const b of BOARDS) {
    const o = document.createElement("option");
    o.value = b.id;
    // An unverified board is LISTED, never hidden. A board missing from the
    // picker reads as "unsupported hardware" and sends its owner to the wrong
    // page; a board shown with its reason sends them to the right one.
    const available = Boolean(offeredIn(loaded, b));
    o.disabled = !available;
    o.textContent = `${b.name} — ${b.id}${available ? "" : " · " + b.webFlashStatus}`;
    sel.appendChild(o);
  }
  const firstEnabled = BOARDS.find((b) => offeredIn(loaded, b));
  sel.value = BOARDS.some((b) => b.id === keep && offeredIn(loaded, b))
    ? keep
    : firstEnabled?.id ?? BOARDS[0].id;
}

function renderBoardNotes(p: BoardProfile) {
  const host = $("board-notes");
  host.innerHTML = "";
  const entry = offeredIn(loaded, p);
  const facts = [
    `${p.chipFamily} · ${p.flashSize} · ${p.flashMode}/${p.flashFreq} · ${p.uploadBaud} baud`,
  ];
  if (!entry) {
    facts.push(t("s2.unavailable"), p.webFlashVerified, t("s2.alt"));
  }
  for (const text of [...facts, ...p.notes]) {
    const d = document.createElement("div");
    d.className = "note";
    d.innerHTML = text.includes("<code") ? text : escapeHtml(text);
    host.appendChild(d);
  }
  $("entry-hint").innerHTML = t(p.nativeUsb ? "s3.hint.native" : "s3.hint.uart");
  refreshProbeButton();
}

function refreshProbeButton() {
  const p = boardById($<HTMLSelectElement>("board").value);
  const ready = $<HTMLInputElement>("ck-daemon").checked && Boolean(p && offeredIn(loaded, p));
  $<HTMLButtonElement>("probe").disabled = !ready;
}

function renderIdentity(p: BoardProfile) {
  if (!session) return;
  const { chip, mac, flashSize, verdict } = session.identified;
  const row = (label: string, detected: string, expected: string) =>
    `<tr><th>${escapeHtml(label)}</th><td class="k">${escapeHtml(detected)}</td><td class="k">${escapeHtml(expected)}</td></tr>`;
  $<HTMLTableElement>("identity").innerHTML =
    `<tr><th></th><th>${escapeHtml(t("s4.detected"))}</th><th>${escapeHtml(t("s4.expected"))}</th></tr>` +
    row(t("s4.chip"), chip, p.chipFamily) +
    row(t("s4.flash"), flashSize ?? "unknown", p.flashSize) +
    row(t("s4.mac"), mac, "—");

  const cls = verdict.mayWrite
    ? verdict.code === "ok" ? "pass" : "partial"
    : "fail";
  const body = escapeHtml(t(`v.${verdict.code}` as MessageKey));
  const noforce = verdict.mayWrite ? "" : `<div class="verdict-sub">${escapeHtml(t("v.noforce"))}</div>`;
  $("verdict").innerHTML = `<div class="verdict ${cls}">${body}${noforce}</div>`;
  // Enabled ONLY by the verdict. writeMerged() re-checks it too, because the
  // button and the write must not share a single point of failure.
  $<HTMLButtonElement>("install").disabled = !verdict.mayWrite;
}

function setPhase(text: string, pct?: number) {
  $("progress").hidden = false;
  $("phase").textContent = pct === undefined ? text : `${text} — ${Math.round(pct)}%`;
  $<HTMLElement>("bar-fill").style.width = `${Math.max(0, Math.min(100, pct ?? 0))}%`;
}

function showError(key: MessageKey, detail?: string) {
  $("error-card").hidden = false;
  $("error-body").innerHTML =
    `<div class="verdict fail">${escapeHtml(t(key))}</div>` +
    (detail ? `<p class="hint mono">${escapeHtml(detail)}</p>` : "");
}

function clearError() {
  $("error-card").hidden = true;
}

/**
 * Map a DOMException from `port.open()` to the instruction that fixes it.
 *
 * The page cannot see the daemon (mixed content blocks an HTTPS→localhost
 * probe), so this rejection is the ONLY signal that the port is held — which
 * makes translating it the difference between an actionable page and
 * "NetworkError: Failed to open serial port".
 */
function classifyOpenError(e: unknown): MessageKey {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (/NotFoundError|No port selected|no port was/i.test(msg)) return "err.no-port";
  if (/NetworkError|Failed to open|access denied|busy/i.test(msg)) return "err.port-busy";
  if (/md5/i.test(msg)) return "err.md5";
  return "err.connect";
}

/* ----------------------------------------------------------------- actions */

async function doProbe() {
  const p = boardById($<HTMLSelectElement>("board").value);
  if (!p) return;
  clearError();
  $("done-card").hidden = true;
  const btn = $<HTMLButtonElement>("probe");
  btn.disabled = true;
  btn.textContent = t("s3.picking");
  try {
    const device = await navigator.serial.requestPort();
    btn.textContent = t("s3.working");
    // Any previous session belongs to a port the user has now replaced.
    if (session) { await finish(session, current ?? p).catch(() => {}); session = null; }
    session = await connectAndIdentify(device, p, { onLog: log });
    current = p;
    $("install-card").hidden = false;
    renderIdentity(p);
  } catch (e) {
    log(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    showError(classifyOpenError(e), e instanceof Error ? e.message : String(e));
  } finally {
    btn.textContent = t("s3.btn");
    refreshProbeButton();
  }
}

async function doInstall() {
  const p = boardById($<HTMLSelectElement>("board").value);
  const entry = p ? offeredIn(loaded, p) : undefined;
  if (!p || !entry || !session || !loaded) return;
  clearError();
  const btn = $<HTMLButtonElement>("install");
  btn.disabled = true;
  try {
    if (!image) {
      setPhase(t("p.download"), 0);
      image = await fetchMergedImage(loaded, entry, (got, total) =>
        setPhase(t("p.download"), total ? (got / total) * 100 : 0),
      );
      setPhase(t("p.verify-download"), 100);
    }
    await writeMerged(
      session,
      entry,
      image,
      { eraseAll: $<HTMLInputElement>("ck-erase").checked },
      {
        onPhase: (ph) => setPhase(t(`p.${ph}` as MessageKey)),
        onProgress: (w, total) => setPhase(t("p.write"), total ? (w / total) * 100 : 0),
        onLog: log,
      },
    );
    setPhase(t("p.done"), 100);
    await finish(session, p);
    session = null;
    current = null;
    $("done-card").hidden = false;
    // TC001's CH340 TX is broken in hardware: it never answers a serial probe,
    // so telling its owner to run a serial check would report a good flash as a
    // failure. Named as an exception here and in docs/esp32.md.
    $("done-extra").innerHTML =
      p.id === "ulanzi_tc001" ? `<div class="note">${escapeHtml(t("done.tc001"))}</div>` : "";
    $("install-card").hidden = true;
  } catch (e) {
    log(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    const msg = e instanceof Error ? e.message : String(e);
    showError(
      /sha256|manifest says|HTTP \d/.test(msg) ? "err.download" : classifyOpenError(e),
      msg,
    );
    btn.disabled = false;
  }
}

/* --------------------------------------------------------------- manifest */

async function initManifest() {
  $("fw-version").textContent = t("fw.loading");
  try {
    loaded = await loadManifest();
    $("fw-version").textContent = loaded.manifest.firmwareVersion;
  } catch (e) {
    loaded = null;
    $("fw-version").textContent = t("fw.none");
    // A picker with nothing in it is indistinguishable from a broken page, so
    // the reason is shown rather than left to the console.
    showError("err.manifest", e instanceof Error ? e.message : String(e));
  }
  renderBoardOptions();
  const p = boardById($<HTMLSelectElement>("board").value);
  if (p) renderBoardNotes(p);
}

/* ----------------------------------------------------------------- wiring */

function wireLocale() {
  const sel = document.getElementById("lang") as HTMLSelectElement | null;
  const apply = (l: Locale) => {
    setLocale(l);
    if (sel) sel.value = l;
    // Dynamic regions are rebuilt: they were composed in the previous locale
    // and setLocale() only rewrites nodes carrying data-i18n.
    const p = boardById($<HTMLSelectElement>("board").value);
    renderBoardOptions();
    if (p) renderBoardNotes(p);
    if (session && p) renderIdentity(p);
    if (loaded) $("fw-version").textContent = loaded.manifest.firmwareVersion;
  };
  apply(readStoredLocale());
  sel?.addEventListener("change", () => {
    const l = (LOCALES as string[]).includes(sel.value) ? (sel.value as Locale) : "en";
    storeLocale(l);
    apply(l);
  });
}

function init() {
  const blocked = browserBlocker();
  setLocale(readStoredLocale());
  if (blocked) {
    $("flow").hidden = true;
    $("unsupported").hidden = false;
    $("unsupported-why").textContent = t(blocked);
    $("copy-cli").addEventListener("click", () => {
      void navigator.clipboard.writeText($("cli-fallback").textContent ?? "");
    });
    // The language picker still has to work on the blocked path — this is the
    // page a non-Chrome user sees, and it is ALL they will read, so a throw
    // here leaves them with nothing at all. The nav is generated into this file
    // by sync-pages-nav, so `#lang` is always present; guarded anyway, because
    // the cost of being wrong is the entire page.
    const sel = document.getElementById("lang") as HTMLSelectElement | null;
    if (sel) sel.value = currentLocale();
    sel?.addEventListener("change", () => {
      const l = (LOCALES as string[]).includes(sel.value) ? (sel.value as Locale) : "en";
      storeLocale(l);
      setLocale(l);
      $("unsupported-why").textContent = t(blocked);
    });
    return;
  }

  wireLocale();
  $<HTMLSelectElement>("board").addEventListener("change", () => {
    // A different board means a different image and a stale identification.
    // RELEASE the old session rather than just forgetting it: Web Serial keeps
    // the port open and locked to this page, so dropping the reference leaves
    // the port held with nothing able to close it — and the next connect then
    // fails with "already open", which this page reports as "the daemon is
    // holding it". A wrong diagnosis the user cannot act on.
    const previous = session;
    const previousBoard = current;
    session = null;
    image = null;
    if (previous && previousBoard) void finish(previous, previousBoard).catch(() => {});
    $("install-card").hidden = true;
    $("done-card").hidden = true;
    const p = boardById($<HTMLSelectElement>("board").value);
    current = p ?? null;
    if (p) renderBoardNotes(p);
  });
  $<HTMLInputElement>("ck-daemon").addEventListener("change", refreshProbeButton);
  $("probe").addEventListener("click", () => void doProbe());
  $("install").addEventListener("click", () => void doInstall());

  void initManifest();
}

init();
