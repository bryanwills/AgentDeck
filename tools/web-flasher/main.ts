import "../../design/tokens.css";
import "./style.css";
import { BOARDS, boardById, type BoardProfile } from "./boards";
import { probeBoard, strategiesFor, type AttemptResult, type ProbeResult } from "./probe";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/* ---------------------------------------------------------------- browser gate
   Checked BEFORE the flow renders. Web Serial is Chrome/Edge desktop only —
   telling someone after they have picked a board and plugged in a cable is the
   worst possible moment to mention it. */
function browserBlocker(): string | null {
  // Read the UA up front: `"serial" in navigator` narrows `navigator` to `never`
  // in the else branch once the w3c-web-serial types are loaded.
  const ua = navigator.userAgent;
  if (!window.isSecureContext) {
    return "This page is not running in a secure context. Web Serial needs HTTPS (or localhost).";
  }
  if (!("serial" in navigator)) {
    if (/Firefox\//.test(ua)) return "Firefox does not implement the Web Serial API.";
    if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) {
      return "Safari does not implement the Web Serial API.";
    }
    if (/Android|iPhone|iPad/.test(ua)) return "Mobile browsers do not implement the Web Serial API.";
    return "This browser does not implement the Web Serial API.";
  }
  return null;
}

/* ------------------------------------------------------------------- rendering */
function renderBoardOptions() {
  const sel = $<HTMLSelectElement>("board");
  sel.innerHTML = "";
  for (const b of BOARDS) {
    const o = document.createElement("option");
    o.value = b.id;
    const mark =
      b.webFlashStatus === "verified" ? "" :
      b.webFlashStatus === "verified-partial" ? " · partly verified" :
      b.webFlashStatus === "blocked" ? " · not flashable here" : " · unverified";
    o.textContent = `${b.name} — ${b.id}${mark}`;
    sel.appendChild(o);
  }
}

function renderBoardNotes(p: BoardProfile) {
  const host = $("board-notes");
  host.innerHTML = "";
  const facts = [
    `${p.chipFamily} · ${p.flashSize} · ${p.flashMode}/${p.flashFreq} · bootloader @ 0x${p.bootloaderOffset.toString(16)}`,
    `declared: --before=${p.before}${p.stub ? "" : " --no-stub"}${p.after === "no_reset" ? " --after=no_reset" : ""} · ${p.uploadBaud} baud`,
    // An unverified board is LISTED, never hidden: a board missing from the
    // picker reads as "unsupported" and sends its owner to the wrong page,
    // while a board shown with its reason sends them to the right one.
    `web flash: ${p.webFlashStatus} — ${p.webFlashVerified || "no run recorded"}`,
  ];
  for (const text of [...facts, ...p.notes]) {
    const d = document.createElement("div");
    d.className = "note";
    d.textContent = text;
    host.appendChild(d);
  }
  $("entry-hint").textContent = p.nativeUsb
    ? "Native USB board: if it will not connect, hold BOOT, tap RST (or replug), release BOOT once the port settles, then pick that port."
    : "USB-serial bridge board: it should enter the bootloader on its own.";
}

function pill(ok: boolean | undefined, yes = "yes", no = "no"): string {
  if (ok === undefined) return `<span class="pill warn">n/a</span>`;
  return `<span class="pill ${ok ? "ok" : "no"}">${ok ? yes : no}</span>`;
}

function renderAttempts(rows: AttemptResult[]) {
  const t = $<HTMLTableElement>("attempts");
  t.innerHTML =
    "<tr><th>strategy</th><th>before / stub</th><th>result</th><th>chip</th><th>flash</th><th>baud</th><th>ms</th></tr>" +
    rows
      .map(
        (r) => `<tr>
        <td class="k">${r.strategy.label}</td>
        <td class="k">${r.strategy.before} / ${r.strategy.stub ? "stub" : "no-stub"}</td>
        <td>${r.ok ? `<span class="pill ok">ok</span>` : `<span class="pill no">fail</span>`}</td>
        <td class="k">${r.chip ?? ""}</td>
        <td class="k">${r.flashSizeDetected ?? ""}</td>
        <td class="k">${r.baudTried ? `${r.baudTried} ${r.baudOk ? "✓" : "✗"}` : ""}</td>
        <td class="k">${r.elapsedMs}</td>
      </tr>${r.error ? `<tr><td colspan="7" class="k">${escapeHtml(r.error)}</td></tr>` : ""}`,
      )
      .join("");
}

function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

function renderVerdict(res: ProbeResult, p: BoardProfile) {
  const host = $("verdict");
  const win = res.attempts.find((a) => a.ok);
  let cls: string, text: string;
  if (res.pass) {
    cls = "pass";
    text = `PASS — ${win?.chip}, flash ${win?.flashSizeDetected}, MAC ${win?.mac}. Winning strategy: ${res.winner?.label} (${res.winner?.before} / ${res.winner?.stub ? "stub" : "no-stub"}).`;
  } else if (win) {
    cls = "partial";
    const bad: string[] = [];
    if (res.chipMatchesProfile === false) bad.push(`chip "${win.chip}" does not match expected ${p.chipFamily}`);
    if (res.flashSizeMatchesProfile === false) bad.push(`detected flash ${win.flashSizeDetected} ≠ declared ${p.flashSize}`);
    text = `CONNECTED BUT DID NOT PASS — ${bad.join("; ")}. This board must not be written until that is explained.`;
  } else {
    cls = "fail";
    text = `NO CONNECTION — all ${res.attempts.length} strategies failed. Check the serial port is free (lsof /dev/cu.*) and, for native-USB boards, enter download mode.`;
  }
  host.innerHTML = `<div class="verdict ${cls}">${escapeHtml(text)}</div>`;
}

/* ----------------------------------------------------------------------- wiring */
let lastResult: ProbeResult | null = null;

function init() {
  const blocked = browserBlocker();
  if (blocked) {
    $("flow").hidden = true;
    $("unsupported").hidden = false;
    $("unsupported-why").textContent = blocked;
    $("copy-cli").addEventListener("click", () => {
      void navigator.clipboard.writeText($("cli-fallback").textContent ?? "");
    });
    return;
  }

  renderBoardOptions();
  const sel = $<HTMLSelectElement>("board");
  const current = () => boardById(sel.value)!;
  renderBoardNotes(current());
  sel.addEventListener("change", () => renderBoardNotes(current()));

  const ck = $<HTMLInputElement>("ck-daemon");
  const btn = $<HTMLButtonElement>("probe");
  ck.addEventListener("change", () => { btn.disabled = !ck.checked; });

  btn.addEventListener("click", async () => {
    const p = current();
    btn.disabled = true;
    btn.textContent = "Select a port…";
    try {
      const device = await navigator.serial.requestPort();
      $("result-card").hidden = false;
      const rows: AttemptResult[] = [];
      btn.textContent = `Probing (${strategiesFor(p).length} strategies)…`;
      const res = await probeBoard(device, p, {
        testBaud: $<HTMLInputElement>("ck-baud").checked,
        onAttempt: (r) => { rows.push(r); renderAttempts(rows); },
      });
      lastResult = res;
      renderAttempts(res.attempts);
      renderVerdict(res, p);
      $("raw").textContent = res.attempts
        .map((a) => `# ${a.strategy.label}\n${a.log.join("")}`)
        .join("\n\n");
    } catch (e) {
      $("result-card").hidden = false;
      $("verdict").innerHTML =
        `<div class="verdict fail">${escapeHtml(e instanceof Error ? e.message : String(e))}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Connect & identify";
    }
  });

  $("copy-json").addEventListener("click", () => {
    if (lastResult) void navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2));
  });
}

init();
