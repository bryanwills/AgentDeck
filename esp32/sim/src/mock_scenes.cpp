// Named mock DashboardState presets for the host simulator. These populate the
// same g_state the firmware fills from the daemon's `state_update` — the
// terrarium reads it identically, so a scene here exercises the real creature
// derivation (session → octopus/cloud/opencode/antigravity + crayfish gateway).
#include "sim.h"
#include "config.h"
#include "state/agent_state.h"
#include <cstring>

namespace {

void setStr(char* dst, size_t cap, const char* src) {
  std::strncpy(dst, src, cap - 1);
  dst[cap - 1] = '\0';
}

// Append one alive session and bump the matching derived creature count.
void addSession(const char* agentType, const char* state) {
  if (g_state.sessionCount >= 10) return;
  SessionInfo& s = g_state.sessions[g_state.sessionCount++];
  std::memset(&s, 0, sizeof(s));
  setStr(s.id, sizeof(s.id), "sim");
  setStr(s.agentType, sizeof(s.agentType), agentType);
  setStr(s.state, sizeof(s.state), state);
  setStr(s.projectName, sizeof(s.projectName), "AgentDeck");
  setStr(s.modelName, sizeof(s.modelName), "opus-4.8");
  s.alive = true;
  if (std::strcmp(agentType, "claude-code") == 0) g_state.octopusCount++;
  else if (std::strcmp(agentType, "codex-cli") == 0 ||
           std::strcmp(agentType, "codex-app") == 0) g_state.cloudCount++;
  else if (std::strcmp(agentType, "opencode") == 0) g_state.opencodeCount++;
  else if (std::strcmp(agentType, "antigravity") == 0) g_state.antigravityCount++;
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
    addSession("claude-code", "idle");
    return true;
  }
  if (std::strcmp(name, "working") == 0) {
    base(CreatureState::WORKING);
    addSession("claude-code", "processing");
    addSession("claude-code", "processing");
    addSession("codex-cli", "processing");
    return true;
  }
  if (std::strcmp(name, "multi") == 0) {
    base(CreatureState::WORKING);
    addSession("claude-code", "processing");
    addSession("codex-cli", "processing");
    addSession("opencode", "idle");
    addSession("antigravity", "idle");
    g_state.crayfishState = CrayfishState::ROUTING;
    g_state.gatewayConnected = true;   // OpenClaw gateway → crayfish visible
    g_state.crayfishCount = 1;
    return true;
  }
  if (std::strcmp(name, "permission") == 0) {
    base(CreatureState::ASKING);
    addSession("claude-code", "awaiting_permission");
    g_state.state = AgentState::AWAITING_PERMISSION;
    return true;
  }
  return false;
}

const char* SimScenes::catalog() {
  return "empty, idle, working, multi, permission";
}
