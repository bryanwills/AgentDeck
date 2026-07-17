// Named mock DashboardState presets for the host simulator. These populate the
// same g_state the firmware fills from the daemon's `state_update` — the
// terrarium reads it identically, so a scene here exercises the real creature
// derivation (session → octopus/cloud/opencode/antigravity + crayfish gateway).
#include "sim.h"
#include "config.h"
#include "state/agent_state.h"
#include <cstdio>
#include <cstring>

namespace {

void setStr(char* dst, size_t cap, const char* src) {
  std::strncpy(dst, src, cap - 1);
  dst[cap - 1] = '\0';
}

// Append one alive session (with a distinct project/display name) and bump the
// matching derived creature count + per-type display-name array the way the
// daemon's sessions_list does, so the HUD list and creature tags read distinctly.
void addSession(const char* agentType, const char* state, const char* project) {
  if (g_state.sessionCount >= 10) return;
  SessionInfo& s = g_state.sessions[g_state.sessionCount];
  std::memset(&s, 0, sizeof(s));
  // Unique per-session id (real sessions are UUIDs); same-project sessions must
  // still be distinct so per-card timeline attribution can be exercised.
  std::snprintf(s.id, sizeof(s.id), "s%u-%s", (unsigned)g_state.sessionCount, project);
  g_state.sessionCount++;
  setStr(s.agentType, sizeof(s.agentType), agentType);
  setStr(s.state, sizeof(s.state), state);
  setStr(s.projectName, sizeof(s.projectName), project);
  setStr(s.modelName, sizeof(s.modelName), "opus-4.8");
  s.alive = true;
  if (std::strcmp(agentType, "claude-code") == 0)
    setStr(g_state.sessionNames[g_state.octopusCount++], 24, project);
  else if (std::strcmp(agentType, "codex-cli") == 0 || std::strcmp(agentType, "codex-app") == 0)
    setStr(g_state.cloudNames[g_state.cloudCount++], 24, project);
  else if (std::strcmp(agentType, "opencode") == 0)
    setStr(g_state.opencodeNames[g_state.opencodeCount++], 24, project);
  else if (std::strcmp(agentType, "antigravity") == 0)
    setStr(g_state.antigravityNames[g_state.antigravityCount++], 24, project);
}

// Append a timeline row the way protocol.cpp handleTimelineEvent does, so card
// bodies / tickers exercise the real per-session attribution + compose paths.
void addTimeline(const char* type, const char* sid, const char* raw, const char* taskId) {
  TimelineEntry e;
  std::memset(&e, 0, sizeof(e));
  setStr(e.type, sizeof(e.type), type);
  setStr(e.raw, sizeof(e.raw), raw);
  setStr(e.sessionId, sizeof(e.sessionId), sid);
  if (taskId) setStr(e.taskId, sizeof(e.taskId), taskId);
  setStr(e.hm, sizeof(e.hm), "12:34");
  e.ts = 12 * 3600 + 34 * 60;
  g_state.addTimelineEntry(e);
}

void base(CreatureState cs) {
  std::memset(&g_state, 0, sizeof(g_state));
  g_state.dataReceived = true;
  g_state.wsConnected = true;
  g_state.state = AgentState::IDLE;
  g_state.creatureState = cs;
  g_state.crayfishState = CrayfishState::DORMANT;
  g_state.tetraState = TetraState::HOVERING;
  setStr(g_state.agentType, sizeof(g_state.agentType), "daemon");
  setStr(g_state.projectName, sizeof(g_state.projectName), "AgentDeck");
  setStr(g_state.modelName, sizeof(g_state.modelName), "opus-4.8");
  g_state.hostDisplayOn = true;      // host-awake baseline for display-sync scenes
  g_state.userBrightness = 255;
  // Usage — drives the 5H/7D rate gauges (matrix usage page, HUD, e-ink).
  g_state.fiveHourPercent = 42.0f;
  g_state.sevenDayPercent = 68.0f;
  setStr(g_state.fiveHourReset, sizeof(g_state.fiveHourReset), "2h 15m");
  setStr(g_state.sevenDayReset, sizeof(g_state.sevenDayReset), "3d 4h");
  g_state.inputTokens = 128000; g_state.outputTokens = 41000;
  g_state.toolCalls = 87; g_state.sessionDurationSec = 5400;
  g_state.estimatedCostUsd = 3.42f;
  g_state.codexPrimaryPercent = -1.0f;   // no Codex-window data by default
  g_state.codexSecondaryPercent = -1.0f;
  g_state.antigravityCredits = -1.0f;
  setStr(g_state.subscriptions[0].name, sizeof(g_state.subscriptions[0].name), "Claude Max");
  setStr(g_state.subscriptions[0].until, sizeof(g_state.subscriptions[0].until), "~7/28");
  g_state.subscriptionCount = 1;
}

}  // namespace

bool SimScenes::apply(const char* name) {
  if (std::strcmp(name, "empty") == 0) {
    std::memset(&g_state, 0, sizeof(g_state));
    g_state.dataReceived = false;   // pre-connection: idle aquarium, no creatures
    return true;
  }
  if (std::strcmp(name, "idle") == 0) {
    base(CreatureState::FLOATING);
    addSession("claude-code", "idle", "AgentDeck");
    return true;
  }
  if (std::strcmp(name, "display-off") == 0) {
    base(CreatureState::FLOATING);
    addSession("claude-code", "idle", "AgentDeck");
    g_state.hostDisplayOn = false;
    return true;
  }
  if (std::strcmp(name, "working") == 0) {
    base(CreatureState::WORKING);
    addSession("claude-code", "processing", "AgentDeck");
    addSession("claude-code", "processing", "bridge");
    addSession("codex-cli", "processing", "firmware");
    return true;
  }
  if (std::strcmp(name, "multi") == 0) {
    base(CreatureState::WORKING);
    addSession("claude-code", "processing", "AgentDeck");
    addSession("codex-cli", "processing", "esp32");
    addSession("opencode", "idle", "docs");
    addSession("antigravity", "idle", "apple");
    g_state.crayfishState = CrayfishState::ROUTING;
    g_state.gatewayConnected = true;   // OpenClaw gateway → crayfish visible
    g_state.crayfishCount = 1;
    return true;
  }
  if (std::strcmp(name, "crowd") == 0) {
    // Real-world shape: many concurrent sessions in the SAME project (one big
    // huddle) plus a couple of stragglers — exercises pod grouping + seating.
    base(CreatureState::WORKING);
    addSession("claude-code", "processing", "AgentDeck");
    addSession("claude-code", "processing", "AgentDeck");
    addSession("codex-cli", "processing", "AgentDeck");
    addSession("opencode", "idle", "AgentDeck");
    addSession("claude-code", "awaiting_permission", "AgentDeck");
    addSession("claude-code", "idle", "babelforge");
    addSession("codex-cli", "idle", "openclaw");
    setStr(g_state.sessions[1].activity, sizeof(g_state.sessions[1].activity),
           "Building the AgentDeck CLI");
    setStr(g_state.sessions[4].question, sizeof(g_state.sessions[4].question),
           "Bash 명령 실행을 허용할까요? rm -rf build/");
    // Per-session timeline rows (Korean + long task headers) — exercises the
    // card-body "<task> · <text>" compose, taskId resolution, and UTF-8-safe
    // truncation exactly the way live daemon rows do.
    addTimeline("task_start", "s0-AgentDeck",
                "ips10 기기에서 에이전트들이 프로젝트 영역 안으로 들어오지 못하는 문제와 카드 텍스트 깨짐을 함께 개선", "t1");
    addTimeline("chat_start", "s0-AgentDeck",
                "타임라인 카드 텍스트가 깨져 보이는 원인을 조사해서 수정하라", "t1");
    addTimeline("chat_response", "s2-AgentDeck",
                "Fixed the treemap sizing so cards fill the pane", nullptr);
    addTimeline("chat_start", "s4-AgentDeck",
                "권한 요청: rm -rf build/ 실행을 허용할까요?", nullptr);
    return true;
  }
  if (std::strcmp(name, "permission") == 0) {
    base(CreatureState::ASKING);
    addSession("claude-code", "awaiting_permission", "AgentDeck");
    g_state.state = AgentState::AWAITING_PERMISSION;
    return true;
  }
  return false;
}

const char* SimScenes::catalog() {
  return "empty, idle, display-off, working, multi, permission";
}
