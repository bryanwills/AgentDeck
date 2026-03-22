#!/usr/bin/env python3
"""
AgentDeck Test Report — HTML Generator

Reads vitest JSON, Android JUnit XML, coverage-summary.json,
and produces a single self-contained HTML dashboard.

Usage:
    python3 scripts/generate-html-report.py
    open coverage/test-report/index.html
"""

import json
import os
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORT_DIR = ROOT / "coverage" / "test-report"
VITEST_JSON = REPORT_DIR / "vitest.json"
COVERAGE_JSON = ROOT / "coverage" / "coverage-summary.json"
ANDROID_XML_DIR = ROOT / "android" / "app" / "build" / "test-results" / "testDebugUnitTest"
OUTPUT_HTML = REPORT_DIR / "index.html"

# ===== Data collection =====

def load_vitest():
    if not VITEST_JSON.exists():
        return None
    with open(VITEST_JSON) as f:
        return json.load(f)

def load_coverage():
    if not COVERAGE_JSON.exists():
        return None
    with open(COVERAGE_JSON) as f:
        return json.load(f)

def load_android_xml():
    suites = []
    if not ANDROID_XML_DIR.exists():
        return suites
    for xml_file in sorted(ANDROID_XML_DIR.glob("TEST-*.xml")):
        tree = ET.parse(xml_file)
        root = tree.getroot()
        suite = {
            "name": root.get("name", xml_file.stem),
            "tests": int(root.get("tests", 0)),
            "failures": int(root.get("failures", 0)),
            "errors": int(root.get("errors", 0)),
            "skipped": int(root.get("skipped", 0)),
            "time": float(root.get("time", 0)),
            "cases": [],
        }
        for tc in root.findall("testcase"):
            failure = tc.find("failure")
            case = {
                "name": tc.get("name", ""),
                "classname": tc.get("classname", ""),
                "time": float(tc.get("time", 0)),
                "status": "failed" if failure is not None else "passed",
                "failure": failure.text if failure is not None else None,
            }
            suite["cases"].append(case)
        suite["passed"] = suite["tests"] - suite["failures"] - suite["errors"] - suite["skipped"]
        suites.append(suite)
    return suites

def extract_package_coverage(cov_data):
    """Group per-file coverage into packages."""
    packages = {}
    for filepath, metrics in cov_data.items():
        if filepath == "total":
            continue
        # Determine package from path
        rel = filepath.replace(str(ROOT) + "/", "")
        parts = rel.split("/")
        if len(parts) >= 2 and parts[0] in ("bridge", "plugin", "shared", "hooks"):
            pkg = parts[0]
        else:
            pkg = "other"

        if pkg not in packages:
            packages[pkg] = {"lines": {"total": 0, "covered": 0}, "statements": {"total": 0, "covered": 0},
                             "functions": {"total": 0, "covered": 0}, "branches": {"total": 0, "covered": 0},
                             "files": []}

        for metric in ("lines", "statements", "functions", "branches"):
            m = metrics.get(metric, {})
            packages[pkg][metric]["total"] += m.get("total", 0)
            packages[pkg][metric]["covered"] += m.get("covered", 0)

        packages[pkg]["files"].append({
            "path": rel,
            "lines_pct": metrics.get("lines", {}).get("pct", 0),
            "stmts_pct": metrics.get("statements", {}).get("pct", 0),
            "funcs_pct": metrics.get("functions", {}).get("pct", 0),
            "branch_pct": metrics.get("branches", {}).get("pct", 0),
        })

    # Compute percentages
    for pkg, data in packages.items():
        for metric in ("lines", "statements", "functions", "branches"):
            t = data[metric]["total"]
            c = data[metric]["covered"]
            data[metric]["pct"] = round(c / t * 100, 1) if t > 0 else 0

    return packages


# ===== HTML generation =====

def pct_color(pct):
    if pct >= 80: return "#22c55e"
    if pct >= 50: return "#eab308"
    if pct >= 20: return "#f97316"
    return "#ef4444"

def gauge_svg(pct, size=48):
    color = pct_color(pct)
    r = size / 2 - 4
    circ = 2 * 3.14159 * r
    offset = circ * (1 - pct / 100)
    return f'''<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}">
      <circle cx="{size/2}" cy="{size/2}" r="{r}" fill="none" stroke="#1e293b" stroke-width="5"/>
      <circle cx="{size/2}" cy="{size/2}" r="{r}" fill="none" stroke="{color}" stroke-width="5"
        stroke-dasharray="{circ}" stroke-dashoffset="{offset}"
        transform="rotate(-90 {size/2} {size/2})" stroke-linecap="round"/>
      <text x="{size/2}" y="{size/2 + 4}" text-anchor="middle" fill="{color}" font-size="11" font-weight="700">{pct:.0f}%</text>
    </svg>'''

def status_badge(status):
    if status == "passed":
        return '<span class="badge pass">PASS</span>'
    elif status == "failed":
        return '<span class="badge fail">FAIL</span>'
    return '<span class="badge skip">SKIP</span>'

def duration_fmt(ms):
    if ms < 1000:
        return f"{ms:.0f}ms"
    s = ms / 1000
    if s < 60:
        return f"{s:.1f}s"
    m = int(s // 60)
    return f"{m}m {s % 60:.0f}s"

def generate_html(vitest, android_suites, cov_data):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # --- Aggregate stats ---
    vt_passed = vitest["numPassedTests"] if vitest else 0
    vt_failed = vitest["numFailedTests"] if vitest else 0
    vt_total = vitest["numTotalTests"] if vitest else 0
    vt_suites = vitest["numTotalTestSuites"] if vitest else 0
    vt_duration = (vitest["testResults"][-1]["endTime"] - vitest["startTime"]) if vitest and vitest.get("testResults") else 0

    and_passed = sum(s["passed"] for s in android_suites)
    and_failed = sum(s["failures"] + s["errors"] for s in android_suites)
    and_total = sum(s["tests"] for s in android_suites)
    and_duration = sum(s["time"] for s in android_suites) * 1000

    total_passed = vt_passed + and_passed
    total_failed = vt_failed + and_failed
    total_all = vt_total + and_total
    total_duration = vt_duration + and_duration

    # Coverage
    cov_total = cov_data.get("total", {}) if cov_data else {}
    lines_pct = cov_total.get("lines", {}).get("pct", 0)
    stmts_pct = cov_total.get("statements", {}).get("pct", 0)
    funcs_pct = cov_total.get("functions", {}).get("pct", 0)
    branch_pct = cov_total.get("branches", {}).get("pct", 0)

    pkg_cov = extract_package_coverage(cov_data) if cov_data else {}

    # Pre-extract coverage numbers (avoid dict literals inside f-strings)
    lines_covered = cov_total.get("lines", {}).get("covered", 0) if cov_total else 0
    lines_total_n = cov_total.get("lines", {}).get("total", 0) if cov_total else 0

    # --- Build vitest file rows ---
    vt_file_rows = ""
    if vitest:
        for result in vitest["testResults"]:
            name = result["name"].replace(str(ROOT) + "/", "")
            st = result["status"]
            assertions = result.get("assertionResults", [])
            passed = sum(1 for a in assertions if a["status"] == "passed")
            failed = sum(1 for a in assertions if a["status"] == "failed")
            dur = result["endTime"] - result["startTime"]
            color = "#22c55e" if st == "passed" else "#ef4444"
            icon = "✓" if st == "passed" else "✗"

            # Individual test rows (collapsed)
            test_rows = ""
            for a in assertions:
                a_icon = "✓" if a["status"] == "passed" else "✗"
                a_color = "#22c55e" if a["status"] == "passed" else "#ef4444"
                ancestors = " › ".join(a.get("ancestorTitles", []))
                prefix = f'<span style="color:#64748b">{ancestors} › </span>' if ancestors else ""
                a_dur = f'{a.get("duration", 0)}ms' if a.get("duration") else ""
                fail_msg = ""
                if a.get("failureMessages"):
                    escaped = a["failureMessages"][0][:300].replace("<", "&lt;").replace(">", "&gt;")
                    fail_msg = f'<div class="fail-msg">{escaped}</div>'
                test_rows += f'''<tr class="test-row" style="display:none">
                    <td style="padding-left:2.5rem;color:{a_color}">{a_icon}</td>
                    <td colspan="3" style="font-size:0.8rem">{prefix}{a["title"]}{fail_msg}</td>
                    <td style="color:#64748b;font-size:0.75rem">{a_dur}</td>
                </tr>'''

            vt_file_rows += f'''<tr class="file-row" onclick="toggleTests(this)" style="cursor:pointer">
                <td style="color:{color};font-weight:600">{icon}</td>
                <td class="file-path">{name}</td>
                <td style="text-align:right"><span style="color:#22c55e">{passed}</span></td>
                <td style="text-align:right"><span style="color:{"#ef4444" if failed else "#64748b"}">{failed}</span></td>
                <td style="color:#64748b">{duration_fmt(dur)}</td>
            </tr>{test_rows}'''

    # --- Build android rows ---
    and_file_rows = ""
    for suite in android_suites:
        short_name = suite["name"].replace("dev.agentdeck.", "")
        color = "#22c55e" if suite["failures"] == 0 else "#ef4444"
        icon = "✓" if suite["failures"] == 0 else "✗"

        test_rows = ""
        for c in suite["cases"]:
            c_icon = "✓" if c["status"] == "passed" else "✗"
            c_color = "#22c55e" if c["status"] == "passed" else "#ef4444"
            c_dur = f'{c["time"]*1000:.0f}ms' if c["time"] > 0 else ""
            fail_msg = ""
            if c.get("failure"):
                escaped = c["failure"][:300].replace("<", "&lt;").replace(">", "&gt;")
                fail_msg = f'<div class="fail-msg">{escaped}</div>'
            test_rows += f'''<tr class="test-row" style="display:none">
                <td style="padding-left:2.5rem;color:{c_color}">{c_icon}</td>
                <td colspan="3" style="font-size:0.8rem">{c["name"]}{fail_msg}</td>
                <td style="color:#64748b;font-size:0.75rem">{c_dur}</td>
            </tr>'''

        and_file_rows += f'''<tr class="file-row" onclick="toggleTests(this)" style="cursor:pointer">
            <td style="color:{color};font-weight:600">{icon}</td>
            <td class="file-path">{short_name}</td>
            <td style="text-align:right"><span style="color:#22c55e">{suite["passed"]}</span></td>
            <td style="text-align:right"><span style="color:{"#ef4444" if suite["failures"] else "#64748b"}">{suite["failures"]}</span></td>
            <td style="color:#64748b">{duration_fmt(suite["time"]*1000)}</td>
        </tr>{test_rows}'''

    # --- Build coverage file rows ---
    cov_file_rows = ""
    for pkg_name in sorted(pkg_cov.keys()):
        pkg = pkg_cov[pkg_name]
        # Sort files: lowest coverage first
        for f in sorted(pkg["files"], key=lambda x: x["lines_pct"]):
            bar_w = min(f["lines_pct"], 100)
            bar_color = pct_color(f["lines_pct"])
            cov_file_rows += f'''<tr>
                <td class="file-path">{f["path"]}</td>
                <td style="text-align:right;color:{pct_color(f["stmts_pct"])}">{f["stmts_pct"]:.0f}%</td>
                <td style="text-align:right;color:{pct_color(f["branch_pct"])}">{f["branch_pct"]:.0f}%</td>
                <td style="text-align:right;color:{pct_color(f["funcs_pct"])}">{f["funcs_pct"]:.0f}%</td>
                <td style="text-align:right;color:{pct_color(f["lines_pct"])}">{f["lines_pct"]:.0f}%</td>
                <td style="width:100px"><div class="cov-bar"><div class="cov-fill" style="width:{bar_w}%;background:{bar_color}"></div></div></td>
            </tr>'''

    # --- Package coverage cards ---
    pkg_cards = ""
    for pkg_name in ("bridge", "plugin", "shared", "hooks"):
        if pkg_name not in pkg_cov:
            continue
        pkg = pkg_cov[pkg_name]
        pkg_cards += f'''<div class="cov-card">
            <div class="cov-card-header">{pkg_name}</div>
            <div class="cov-card-gauges">
                <div class="gauge-item">{gauge_svg(pkg["lines"]["pct"])}<span>Lines</span></div>
                <div class="gauge-item">{gauge_svg(pkg["statements"]["pct"])}<span>Stmts</span></div>
                <div class="gauge-item">{gauge_svg(pkg["functions"]["pct"])}<span>Funcs</span></div>
                <div class="gauge-item">{gauge_svg(pkg["branches"]["pct"])}<span>Branch</span></div>
            </div>
            <div class="cov-card-detail">{pkg["lines"]["covered"]}/{pkg["lines"]["total"]} lines covered</div>
        </div>'''

    # --- Overall status ---
    overall_status = "PASS" if total_failed == 0 else "FAIL"
    overall_color = "#22c55e" if total_failed == 0 else "#ef4444"

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AgentDeck Test Report</title>
<style>
:root {{ --bg: #0f172a; --surface: #1e293b; --surface2: #334155; --text: #e2e8f0; --dim: #64748b; --accent: #38bdf8; }}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', 'Inter', system-ui, sans-serif; line-height: 1.5; padding: 2rem; }}
.container {{ max-width: 1200px; margin: 0 auto; }}
h1 {{ font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; }}
.subtitle {{ color: var(--dim); font-size: 0.85rem; margin-bottom: 2rem; }}

/* Summary cards */
.summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }}
.card {{ background: var(--surface); border-radius: 12px; padding: 1.25rem; }}
.card-label {{ color: var(--dim); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }}
.card-value {{ font-size: 2rem; font-weight: 700; }}
.card-sub {{ color: var(--dim); font-size: 0.8rem; margin-top: 0.25rem; }}

/* Suite bars */
.suite-bars {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem; }}
.suite-bar {{ background: var(--surface); border-radius: 12px; padding: 1rem 1.25rem; }}
.suite-bar-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }}
.suite-bar-header h3 {{ font-size: 0.95rem; font-weight: 600; }}
.badge {{ font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; }}
.badge.pass {{ background: #16a34a22; color: #22c55e; }}
.badge.fail {{ background: #dc262622; color: #ef4444; }}
.badge.skip {{ background: #ca8a0422; color: #eab308; }}
.progress-bar {{ height: 6px; background: var(--surface2); border-radius: 3px; overflow: hidden; }}
.progress-fill {{ height: 100%; border-radius: 3px; transition: width 0.5s; }}
.suite-stats {{ display: flex; gap: 1rem; margin-top: 0.5rem; font-size: 0.8rem; color: var(--dim); }}

/* Sections */
.section {{ margin-bottom: 2.5rem; }}
.section-title {{ font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }}
.section-title span {{ color: var(--dim); font-size: 0.85rem; font-weight: 400; }}

/* Tables */
table {{ width: 100%; border-collapse: collapse; }}
th {{ text-align: left; color: var(--dim); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--surface2); }}
td {{ padding: 0.5rem 0.75rem; border-bottom: 1px solid #1e293b; font-size: 0.85rem; }}
.file-row:hover {{ background: var(--surface); }}
.file-path {{ font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.8rem; }}
.test-row {{ background: #0f172a; }}
.test-row td {{ border-bottom: 1px solid #1a2332; }}
.fail-msg {{ color: #ef4444; font-size: 0.75rem; margin-top: 0.25rem; font-family: monospace; white-space: pre-wrap; max-height: 100px; overflow: auto; }}

/* Coverage cards */
.cov-cards {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }}
.cov-card {{ background: var(--surface); border-radius: 12px; padding: 1rem; }}
.cov-card-header {{ font-weight: 600; font-size: 0.95rem; margin-bottom: 0.75rem; }}
.cov-card-gauges {{ display: flex; justify-content: space-around; }}
.gauge-item {{ text-align: center; }}
.gauge-item span {{ display: block; font-size: 0.7rem; color: var(--dim); margin-top: 2px; }}
.cov-card-detail {{ text-align: center; color: var(--dim); font-size: 0.75rem; margin-top: 0.75rem; }}

/* Coverage bar in table */
.cov-bar {{ height: 6px; background: var(--surface2); border-radius: 3px; overflow: hidden; }}
.cov-fill {{ height: 100%; border-radius: 3px; }}

/* Coverage table filter */
.cov-filter {{ margin-bottom: 1rem; display: flex; gap: 0.5rem; }}
.cov-filter button {{ background: var(--surface); color: var(--text); border: 1px solid var(--surface2); padding: 4px 12px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; }}
.cov-filter button.active {{ background: var(--accent); color: var(--bg); border-color: var(--accent); }}

/* Expand/collapse */
.expand-hint {{ color: var(--dim); font-size: 0.75rem; cursor: pointer; }}
.expand-hint:hover {{ color: var(--accent); }}

/* Threshold indicators */
.threshold {{ display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; background: var(--surface); padding: 4px 12px; border-radius: 6px; margin-right: 0.5rem; margin-bottom: 0.5rem; }}
.threshold .dot {{ width: 8px; height: 8px; border-radius: 50%; }}

/* Responsive */
@media (max-width: 640px) {{
  body {{ padding: 1rem; }}
  .summary {{ grid-template-columns: repeat(2, 1fr); }}
}}
</style>
</head>
<body>
<div class="container">
  <h1>🐙 AgentDeck Test Report</h1>
  <p class="subtitle">Generated {now} &middot; {total_all} tests across {vt_suites + len(android_suites)} suites</p>

  <!-- Summary Cards -->
  <div class="summary">
    <div class="card">
      <div class="card-label">Status</div>
      <div class="card-value" style="color:{overall_color}">{overall_status}</div>
      <div class="card-sub">{total_all} total tests</div>
    </div>
    <div class="card">
      <div class="card-label">Passed</div>
      <div class="card-value" style="color:#22c55e">{total_passed}</div>
      <div class="card-sub">{total_passed/total_all*100:.1f}% pass rate</div>
    </div>
    <div class="card">
      <div class="card-label">Failed</div>
      <div class="card-value" style="color:{"#ef4444" if total_failed else "#64748b"}">{total_failed}</div>
      <div class="card-sub">&nbsp;</div>
    </div>
    <div class="card">
      <div class="card-label">Duration</div>
      <div class="card-value" style="color:var(--accent)">{duration_fmt(total_duration)}</div>
      <div class="card-sub">{duration_fmt(vt_duration)} vitest + {duration_fmt(and_duration)} android</div>
    </div>
    <div class="card">
      <div class="card-label">Line Coverage</div>
      <div class="card-value" style="color:{pct_color(lines_pct)}">{lines_pct:.1f}%</div>
      <div class="card-sub">{lines_covered:,}/{lines_total_n:,} lines</div>
    </div>
  </div>

  <!-- Suite Bars -->
  <div class="suite-bars">
    <div class="suite-bar">
      <div class="suite-bar-header">
        <h3>Vitest</h3>
        {status_badge("passed" if vt_failed == 0 else "failed")}
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:{vt_passed/vt_total*100 if vt_total else 0:.1f}%;background:#22c55e"></div>
      </div>
      <div class="suite-stats">
        <span>✓ {vt_passed}</span>
        <span>✗ {vt_failed}</span>
        <span>{vt_suites} files</span>
        <span>{duration_fmt(vt_duration)}</span>
      </div>
    </div>
    <div class="suite-bar">
      <div class="suite-bar-header">
        <h3>Android</h3>
        {status_badge("passed" if and_failed == 0 else "failed") if android_suites else status_badge("skip")}
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:{and_passed/and_total*100 if and_total else 0:.1f}%;background:#22c55e"></div>
      </div>
      <div class="suite-stats">
        <span>✓ {and_passed}</span>
        <span>✗ {and_failed}</span>
        <span>{len(android_suites)} files</span>
        <span>{duration_fmt(and_duration)}</span>
      </div>
    </div>
    <div class="suite-bar">
      <div class="suite-bar-header">
        <h3>Apple (XCTest)</h3>
        {status_badge("skip")}
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:0"></div></div>
      <div class="suite-stats"><span style="color:var(--dim)">Xcode scheme not configured for test action</span></div>
    </div>
    <div class="suite-bar">
      <div class="suite-bar-header">
        <h3>Robot Framework</h3>
        {status_badge("skip")}
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:0"></div></div>
      <div class="suite-stats"><span style="color:var(--dim)">Requires ESP32 hardware</span></div>
    </div>
  </div>

  <!-- Vitest Detail -->
  <div class="section">
    <div class="section-title">Vitest <span>bridge / plugin / shared / hooks &middot; {vt_suites} files &middot; {vt_total} tests</span>
      <span class="expand-hint" onclick="toggleAllTests('vitest-table')">[expand all]</span>
    </div>
    <table id="vitest-table">
      <thead><tr>
        <th style="width:30px"></th>
        <th>File</th>
        <th style="text-align:right;width:60px">Pass</th>
        <th style="text-align:right;width:60px">Fail</th>
        <th style="width:80px">Time</th>
      </tr></thead>
      <tbody>{vt_file_rows}</tbody>
    </table>
  </div>

  <!-- Android Detail -->
  {"" if not android_suites else f'''<div class="section">
    <div class="section-title">Android <span>JUnit + Robolectric &middot; {len(android_suites)} files &middot; {and_total} tests</span>
      <span class="expand-hint" onclick="toggleAllTests('android-table')">[expand all]</span>
    </div>
    <table id="android-table">
      <thead><tr>
        <th style="width:30px"></th>
        <th>Suite</th>
        <th style="text-align:right;width:60px">Pass</th>
        <th style="text-align:right;width:60px">Fail</th>
        <th style="width:80px">Time</th>
      </tr></thead>
      <tbody>{and_file_rows}</tbody>
    </table>
  </div>'''}

  <!-- Coverage Overview -->
  {"" if not cov_data else f'''<div class="section">
    <div class="section-title">Coverage <span>v8 provider &middot; {lines_total_n:,} lines tracked</span></div>

    <div style="margin-bottom:1rem">
      <div class="threshold"><div class="dot" style="background:{"#22c55e" if lines_pct >= 18 else "#ef4444"}"></div>Lines ≥18%: {lines_pct:.1f}%</div>
      <div class="threshold"><div class="dot" style="background:{"#22c55e" if funcs_pct >= 16 else "#ef4444"}"></div>Functions ≥16%: {funcs_pct:.1f}%</div>
      <div class="threshold"><div class="dot" style="background:{"#22c55e" if branch_pct >= 14 else "#ef4444"}"></div>Branches ≥14%: {branch_pct:.1f}%</div>
      <div class="threshold"><div class="dot" style="background:{"#22c55e" if stmts_pct >= 18 else "#ef4444"}"></div>Statements ≥18%: {stmts_pct:.1f}%</div>
    </div>

    <div class="cov-cards">{pkg_cards}</div>

    <div class="cov-filter">
      <button class="active" onclick="filterCov('all',this)">All</button>
      <button onclick="filterCov('bridge',this)">bridge</button>
      <button onclick="filterCov('plugin',this)">plugin</button>
      <button onclick="filterCov('shared',this)">shared</button>
      <button onclick="filterCov('uncovered',this)">0% only</button>
    </div>

    <table id="cov-table">
      <thead><tr>
        <th>File</th>
        <th style="text-align:right;width:70px">Stmts</th>
        <th style="text-align:right;width:70px">Branch</th>
        <th style="text-align:right;width:70px">Funcs</th>
        <th style="text-align:right;width:70px">Lines</th>
        <th style="width:110px"></th>
      </tr></thead>
      <tbody>{cov_file_rows}</tbody>
    </table>
  </div>'''}

</div>

<script>
function toggleTests(fileRow) {{
  let next = fileRow.nextElementSibling;
  while (next && next.classList.contains('test-row')) {{
    next.style.display = next.style.display === 'none' ? '' : 'none';
    next = next.nextElementSibling;
  }}
}}

function toggleAllTests(tableId) {{
  const table = document.getElementById(tableId);
  const rows = table.querySelectorAll('.test-row');
  const anyHidden = Array.from(rows).some(r => r.style.display === 'none');
  rows.forEach(r => r.style.display = anyHidden ? '' : 'none');
}}

function filterCov(pkg, btn) {{
  document.querySelectorAll('.cov-filter button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const rows = document.querySelectorAll('#cov-table tbody tr');
  rows.forEach(r => {{
    const path = r.querySelector('.file-path')?.textContent || '';
    const linesPct = parseFloat(r.querySelectorAll('td')[4]?.textContent) || 0;
    if (pkg === 'all') {{ r.style.display = ''; }}
    else if (pkg === 'uncovered') {{ r.style.display = linesPct === 0 ? '' : 'none'; }}
    else {{ r.style.display = path.startsWith(pkg + '/') ? '' : 'none'; }}
  }});
}}
</script>
</body>
</html>'''
    return html


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    vitest = load_vitest()
    android = load_android_xml()
    cov = load_coverage()

    if not vitest and not android:
        print("No test results found. Run 'pnpm test:report' first.")
        sys.exit(1)

    html = generate_html(vitest, android, cov)
    OUTPUT_HTML.write_text(html, encoding="utf-8")
    print(f"HTML report: {OUTPUT_HTML}")


if __name__ == "__main__":
    main()
