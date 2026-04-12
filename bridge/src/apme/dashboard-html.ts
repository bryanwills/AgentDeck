/**
 * APME Web Dashboard — self-contained inline HTML.
 * Served at GET /apme by both Node.js daemon and Swift daemon.
 * No external dependencies — vanilla JS + CSS + fetch polling.
 */

export function apmeDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentDeck APME Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,sans-serif;padding:16px 24px;font-size:13px}
h1{font-size:18px;color:#94a3b8;margin-bottom:4px;display:flex;align-items:center;gap:8px}
h2{font-size:14px;color:#64748b;margin:16px 0 8px;text-transform:uppercase;letter-spacing:0.5px}
.live{display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.card{background:#1e293b;border-radius:8px;padding:12px;margin-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:#64748b;font-weight:500;padding:6px 8px;border-bottom:1px solid #334155}
td{padding:6px 8px;border-bottom:1px solid #1e293b}
tr:hover td{background:#1e293b;cursor:pointer}
tr.selected td{background:#1e3a5f}
.score{font-weight:600}
.score-high{color:#22c55e}
.score-mid{color:#f59e0b}
.score-low{color:#ef4444}
.score-na{color:#475569}
.outcome{font-size:11px;padding:2px 6px;border-radius:4px;font-weight:500}
.outcome-committed{background:#166534;color:#bbf7d0}
.outcome-abandoned{background:#7f1d1d;color:#fecaca}
.outcome-iterated{background:#78350f;color:#fef3c7}
.outcome-exploratory{background:#1e3a5f;color:#93c5fd}
.detail{background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:16px;margin-top:8px;display:none}
.detail.visible{display:block}
.detail h3{font-size:14px;color:#e2e8f0;margin-bottom:12px}
.section{margin-bottom:12px}
.section-title{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;border-bottom:1px solid #1e293b;padding-bottom:4px}
.done{color:#22c55e}
.missed{color:#ef4444}
.meta{color:#64748b;font-size:11px}
.vibe-btn{padding:6px 16px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;margin-right:8px}
.vibe-approve{background:#166534;color:#bbf7d0}
.vibe-reject{background:#7f1d1d;color:#fecaca}
.vibe-btn:hover{opacity:0.8}
.turn{padding:8px;background:#1e293b;border-radius:6px;margin-bottom:4px}
.turn-prompt{color:#e2e8f0;font-size:12px;margin-bottom:4px}
.turn-meta{color:#64748b;font-size:11px}
.weight-breakdown{font-family:monospace;font-size:11px;color:#94a3b8;margin-top:4px}
.tabs{display:flex;gap:4px;margin-bottom:12px}
.tab{padding:6px 12px;border-radius:6px;border:1px solid #334155;background:transparent;color:#94a3b8;cursor:pointer;font-size:12px}
.tab.active{background:#334155;color:#e2e8f0}
.panel{display:none}.panel.visible{display:block}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px}
.grid .card{text-align:center}
.grid .val{font-size:20px;font-weight:600}
.grid .lbl{font-size:10px;color:#64748b;text-transform:uppercase}
.empty{color:#475569;font-style:italic;padding:16px;text-align:center}
</style>
</head>
<body>
<h1><span class="live"></span> AgentDeck APME Dashboard</h1>
<p class="meta" id="status">Loading...</p>

<div class="tabs">
  <button class="tab active" onclick="showTab('runs')">Runs</button>
  <button class="tab" onclick="showTab('scorecard')">Scorecard</button>
  <button class="tab" onclick="showTab('categories')">Categories</button>
</div>

<!-- Runs panel -->
<div class="panel visible" id="panel-runs">
  <table id="runs-table">
    <thead><tr><th>ID</th><th>Agent</th><th>Model</th><th>Project</th><th>Category</th><th>Score</th><th>Outcome</th><th>Task</th><th>Dur</th></tr></thead>
    <tbody id="runs-body"></tbody>
  </table>
  <div class="detail" id="run-detail"></div>
</div>

<!-- Scorecard panel -->
<div class="panel" id="panel-scorecard">
  <div id="scorecard-content" class="empty">Loading scorecard...</div>
</div>

<!-- Categories panel -->
<div class="panel" id="panel-categories">
  <div id="categories-content" class="empty">Loading categories...</div>
</div>

<script>
const BASE = location.origin;
let selectedRunId = null;

// Tab switching
function showTab(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('visible');
  document.querySelector('[onclick="showTab(\\'' + name + '\\')"]')?.classList.add('active');
}

// Score formatting
function fmtScore(s) {
  if (s == null) return '<span class="score score-na">—</span>';
  const pct = Math.round(s * 100);
  const cls = pct >= 70 ? 'score-high' : pct >= 40 ? 'score-mid' : 'score-low';
  return '<span class="score ' + cls + '">' + pct + '%</span>';
}

function fmtOutcome(o) {
  if (!o) return '';
  const cls = 'outcome outcome-' + o;
  return '<span class="' + cls + '">' + o + '</span>';
}

function fmtDur(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return s >= 60 ? Math.floor(s/60) + 'm' + (s%60) + 's' : s + 's';
}

// Fetch + render runs
async function loadRuns() {
  try {
    const r = await fetch(BASE + '/apme/runs?limit=30');
    const d = await r.json();
    const runs = d.runs || [];
    const tbody = document.getElementById('runs-body');
    tbody.innerHTML = runs.map(r => {
      const score = r.overallScore;
      const dur = r.endedAt && r.startedAt ? r.endedAt - r.startedAt : null;
      const task = r.taskPrompt ? r.taskPrompt.slice(0, 60) : '—';
      const sel = r.id === selectedRunId ? ' class="selected"' : '';
      return '<tr' + sel + ' onclick="selectRun(\\'' + r.id + '\\')">' +
        '<td>' + r.id.slice(0,8) + '</td>' +
        '<td>' + (r.agentType||'—') + '</td>' +
        '<td>' + (r.modelId||'—').slice(0,14) + '</td>' +
        '<td>' + (r.projectName||'—') + '</td>' +
        '<td>' + (r.taskCategory||'—') + '</td>' +
        '<td>' + fmtScore(score) + '</td>' +
        '<td>' + fmtOutcome(r.outcome) + '</td>' +
        '<td title="' + esc(r.taskPrompt||'') + '">' + esc(task) + '</td>' +
        '<td>' + fmtDur(dur) + '</td></tr>';
    }).join('');
    if (runs.length === 0) tbody.innerHTML = '<tr><td colspan="9" class="empty">No runs yet</td></tr>';
    document.getElementById('status').textContent = runs.length + ' runs — last refresh ' + new Date().toLocaleTimeString();
  } catch(e) {
    document.getElementById('status').textContent = 'Error: ' + e.message;
  }
}

// Run detail
async function selectRun(id) {
  selectedRunId = id;
  loadRuns(); // re-render selection highlight
  const el = document.getElementById('run-detail');
  el.classList.add('visible');
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const r = await fetch(BASE + '/apme/run/' + id);
    const d = await r.json();
    const run = d.run;
    const evals = d.evals || [];
    const turns = d.turns || [];
    const vibe = d.vibe;

    let html = '<h3>' + run.id.slice(0,10) + ' — ' + (run.agent_type||'') + ' / ' + (run.model_id||'—') + ' / ' + (run.project_name||'—') + '</h3>';

    // Task
    if (run.task_prompt) {
      html += '<div class="section"><div class="section-title">Task</div>' + esc(run.task_prompt.slice(0,500)) + '</div>';
    }

    // Outcome
    if (run.outcome) {
      html += '<div class="section"><div class="section-title">Outcome — ' + run.outcome_confidence + '</div>' + fmtOutcome(run.outcome) + '</div>';
    }

    // Judge
    const judgeEvals = evals.filter(e => e.layer === 'llm_judge');
    if (judgeEvals.length > 0) {
      const overall = judgeEvals.find(e => e.metric === 'overall');
      html += '<div class="section"><div class="section-title">LLM Judge — ' + fmtScore(overall?.score) + '</div>';
      for (const e of judgeEvals.filter(e => e.metric !== 'overall')) {
        html += e.metric + ': ' + fmtScore(e.score) + '&nbsp;&nbsp;';
      }
      if (overall?.raw) {
        try {
          const raw = JSON.parse(overall.raw);
          if (raw.done?.length) html += '<br>' + raw.done.map(i => '<span class="done">✓ ' + esc(i) + '</span>').join('<br>');
          if (raw.missed?.length) html += '<br>' + raw.missed.map(i => '<span class="missed">✗ ' + esc(i) + '</span>').join('<br>');
          if (raw.reasoning) html += '<br><span class="meta">' + esc(raw.reasoning.slice(0,300)) + '</span>';
        } catch {}
      }
      html += '</div>';
    }

    // Efficiency
    if (run.efficiency_json) {
      try {
        const eff = JSON.parse(run.efficiency_json);
        html += '<div class="section"><div class="section-title">Efficiency</div><div class="grid">';
        if (eff.diffLines!=null) html += '<div class="card"><div class="val">' + eff.diffLines + '</div><div class="lbl">Lines Changed</div></div>';
        if (eff.tokensPerChange!=null) html += '<div class="card"><div class="val">' + eff.tokensPerChange + '</div><div class="lbl">Tokens/Line</div></div>';
        if (eff.toolEfficiency!=null) html += '<div class="card"><div class="val">' + eff.toolEfficiency + '</div><div class="lbl">Lines/Tool</div></div>';
        if (eff.timeToCompleteSec!=null) html += '<div class="card"><div class="val">' + eff.timeToCompleteSec + 's</div><div class="lbl">Duration</div></div>';
        html += '</div></div>';
      } catch {}
    }

    // Composite
    if (run.composite_score != null) {
      html += '<div class="section"><div class="section-title">Composite Score — ' + fmtScore(run.composite_score) + '</div>';
      html += '<div class="weight-breakdown">outcome(' + (run.outcome||'—') + ')×0.4 + judge(' + (judgeEvals.find(e=>e.metric==='overall')?.score??'—') + ')×0.3 + efficiency×0.2 + vibe(' + (vibe?.verdict||'—') + ')×0.1</div>';
      html += '</div>';
    }

    // Turns
    if (turns.length > 0) {
      html += '<div class="section"><div class="section-title">Turns (' + turns.length + ')</div>';
      for (const t of turns) {
        const prompt = t.prompt ? esc(t.prompt.slice(0,120)) : '(no prompt)';
        const dur = t.ended_at && t.started_at ? Math.round((t.ended_at - t.started_at)/1000) + 's' : 'open';
        const tc = t.tool_calls || 0;
        const fm = t.files_modified || 0;
        const fc = t.files_created || 0;
        html += '<div class="turn"><div class="turn-prompt">[' + t.turn_index + '] "' + prompt + '"</div>';
        html += '<div class="turn-meta">' + tc + ' tools, ' + fm + ' edits, ' + fc + ' creates, ' + dur + '</div></div>';
      }
      html += '</div>';
    }

    // Vibe buttons
    html += '<div style="margin-top:12px">';
    html += '<button class="vibe-btn vibe-approve" onclick="submitVibe(\\'' + run.id + '\\',\\'approve\\')">👍 Approve</button>';
    html += '<button class="vibe-btn vibe-reject" onclick="submitVibe(\\'' + run.id + '\\',\\'reject\\')">👎 Reject</button>';
    if (vibe) html += '<span class="meta" style="margin-left:8px">Current: ' + vibe.verdict + (vibe.note ? ' — ' + esc(vibe.note) : '') + '</span>';
    html += '</div>';

    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<div class="empty">Error: ' + e.message + '</div>';
  }
}

async function submitVibe(runId, verdict) {
  try {
    await fetch(BASE + '/apme/vibe', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({runId, verdict})
    });
    selectRun(runId); // refresh detail
  } catch(e) {
    alert('Vibe failed: ' + e.message);
  }
}

// Scorecard
async function loadScorecard() {
  try {
    const r = await fetch(BASE + '/apme/scorecard');
    const d = await r.json();
    const cards = d.scorecards || [];
    if (cards.length === 0) { document.getElementById('scorecard-content').innerHTML = '<div class="empty">No scorecard data yet</div>'; return; }
    let html = '<table><thead><tr><th>Model</th><th>Agent</th><th>Runs</th><th>Score</th><th>Tests</th><th>Cost</th><th>$/Quality</th></tr></thead><tbody>';
    for (const c of cards) {
      html += '<tr><td>' + c.modelId + '</td><td>' + c.agentType + '</td><td>' + c.runs + '</td>';
      html += '<td>' + fmtScore(c.avgOverall) + '</td>';
      html += '<td>' + fmtScore(c.avgTestsPass) + '</td>';
      html += '<td>' + (c.totalCost!=null?'$'+c.totalCost.toFixed(2):'—') + '</td>';
      html += '<td>' + (c.costPerQuality!=null?'$'+c.costPerQuality.toFixed(2):'—') + '</td></tr>';
    }
    html += '</tbody></table>';
    document.getElementById('scorecard-content').innerHTML = html;
  } catch(e) {
    document.getElementById('scorecard-content').innerHTML = '<div class="empty">Error: ' + e.message + '</div>';
  }
}

// Categories
async function loadCategories() {
  try {
    const r = await fetch(BASE + '/apme/categories');
    const d = await r.json();
    const cats = d.categories || [];
    if (cats.length === 0) { document.getElementById('categories-content').innerHTML = '<div class="empty">No category data yet</div>'; return; }
    let html = '<table><thead><tr><th>Category</th><th>Model</th><th>Runs</th><th>Score</th><th>Tests</th><th>Cost</th></tr></thead><tbody>';
    for (const c of cats) {
      html += '<tr><td>' + c.taskCategory + '</td><td>' + c.modelId + '</td><td>' + c.runs + '</td>';
      html += '<td>' + fmtScore(c.avgOverall) + '</td>';
      html += '<td>' + fmtScore(c.avgTestsPass) + '</td>';
      html += '<td>' + (c.totalCost!=null?'$'+c.totalCost.toFixed(2):'—') + '</td></tr>';
    }
    html += '</tbody></table>';
    document.getElementById('categories-content').innerHTML = html;
  } catch(e) {
    document.getElementById('categories-content').innerHTML = '<div class="empty">Error: ' + e.message + '</div>';
  }
}

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Initial load + 15s polling
loadRuns(); loadScorecard(); loadCategories();
setInterval(loadRuns, 15000);
setInterval(loadScorecard, 30000);
setInterval(loadCategories, 30000);
</script>
</body>
</html>`;
}
