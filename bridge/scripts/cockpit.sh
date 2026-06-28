#!/usr/bin/env bash
# agentdeck wt — worktree compare: run several coding agents on one prompt in an
# isolated tmux grid, then review and merge the best (workmux + tmux + git).
# Invoke as `agentdeck wt <cmd>`. Short aliases shown in ().
#
#   wt start|b "<prompt>" [name]   Broadcast a prompt to every agent: a grid on top + command bar below
#   wt send|s "<text>"             Send a follow-up instruction to every agent in the grid
#   wt pick|p                      Focused pane = winner -> (auto-commit) merge to main + clean up the rest
#   wt fork|f "<prompt>"           Branch a new round from the focused pane's WIP (no merge to main)
#   wt drop|x                      Remove just the focused pane; the grid re-tiles (survivors grow)
#   wt abandon|a                   Discard the current grid without merging (review-only round)
#   wt score|r                     Overlay ★ APME score on each pane border (use workmux dashboard for diffs)
#   wt grid|g                      Jump to the active grid window
#   wt agents [names...]           (CLI) Show or set the agent set compared by `wt start`
#   wt list|ls | clean|clear       List worktrees / remove all compare worktrees + grid windows
#
# Agent set: managed via `agentdeck wt agents`; default claude codex opencode.
# Most operations are in-grid keybindings (prefix + S/P/F/X/G/R), so the only
# command you usually type is `agentdeck wt start "..."`.
set -euo pipefail

: "${COCKPIT_AGENTS:=claude codex opencode}"
: "${COCKPIT_SENDKEYS_AGENTS:=agy}"   # non-builtin agents workmux can't prompt-inject -> send via send-keys
: "${COCKPIT_SEND_DELAY:=0.4}"        # delay between paste and Enter (avoids codex submit race)
WIN_PREFIX="wt"
BAR_HEIGHT=6
APME_DB="$HOME/.agentdeck/apme.sqlite"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
# Path the keybindings call back through. When run via `agentdeck wt`, the CLI
# sets COCKPIT_INVOKE='agentdeck wt'; standalone falls back to this script path.
INVOKE="${COCKPIT_INVOKE:-$SELF}"

die(){ echo "wt: $*" >&2; exit 1; }
need_tmux(){ [ -n "${TMUX:-}" ] || die "run inside a tmux session"; }
need_repo(){ git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "run inside a git repository"; }
goto_root(){ local r; r=$(tmux show-options -wqv @cockpit_root 2>/dev/null || true); [ -n "$r" ] && cd "$r" || true; }
pane_wt(){ tmux show-options -pqv -t "$1" @worktree 2>/dev/null || true; }
# Type the prompt into a pane and submit it. codex leaves the text in the input
# box if Enter arrives right after the paste, so we delay between the two
# (harmless for claude/opencode).
_send_to_pane(){
  tmux send-keys -t "$1" -l -- "$2"
  sleep "$COCKPIT_SEND_DELAY"
  tmux send-keys -t "$1" Enter
}
# Absolute worktree path (workmux path -> fallback to <repo>__worktrees/<wt>). Used for APME score mapping.
_wt_path(){
  local p root; p=$(workmux path "$1" 2>/dev/null || true)
  if [ -z "$p" ] || [ ! -d "$p" ]; then
    root=$(tmux show-options -wqv @cockpit_root 2>/dev/null || true)
    [ -n "$root" ] && p="$(dirname "$root")/$(basename "$root")__worktrees/$1"
  fi
  [ -d "$p" ] && printf '%s' "$p"
}
# Keep only [a-z0-9-] for a git-safe kebab name (stdin or $1). Capped at 28 chars.
_sanitize_slug(){
  local s="${1-$(cat)}"
  printf '%s' "$s" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-' \
    | sed -E 's/-+/-/g; s/^-+//; s/-+$//' | cut -c1-28 | sed -E 's/-+$//'
}
# Prompt (any language) -> short english kebab branch name.
#   COCKPIT_NAMER: fm (Apple Intelligence, default, on-device) | mlx (local Qwen3.6) | off.
#   fm falls back to mlx, then to the prompt's ASCII letters.
: "${COCKPIT_NAMER:=fm}"
: "${COCKPIT_NAMER_URL:=http://localhost:8800/v1/chat/completions}"
# FM helper default: relative to this script (resolving symlinks), ../assets/fm-helper/...
# When run via `agentdeck`, the CLI injects COCKPIT_FM_HELPER, so this is only a standalone fallback.
_self_dir(){
  local s="$SELF"
  [ -L "$s" ] && s="$(readlink "$s")"
  case "$s" in /*) ;; *) s="$(cd "$(dirname "$SELF")" && pwd)/$s";; esac
  (cd "$(dirname "$s")" && pwd)
}
: "${COCKPIT_FM_HELPER:=$(_self_dir)/../assets/fm-helper/agentdeck-fm-helper}"
# Daemon URL: COCKPIT_DAEMON_PORT (injected) -> daemon.json httpPort -> 9120.
: "${COCKPIT_DAEMON_PORT:=}"
if [ -z "${COCKPIT_DAEMON_URL:-}" ]; then
  _p="${COCKPIT_DAEMON_PORT:-}"
  [ -n "$_p" ] || _p=$(jq -r '.httpPort // .port // empty' "$HOME/.agentdeck/daemon.json" 2>/dev/null || true)
  [ -n "$_p" ] || _p=9120
  COCKPIT_DAEMON_URL="http://127.0.0.1:$_p"
fi
_NAME_INSTR='Output ONLY a short lowercase kebab-case english git branch name, max 3 words, only a-z 0-9 and hyphens, no quotes, no explanation, no slashes, summarizing this task: '
_FM_SYS='You output only a short kebab-case git branch name and nothing else.'
_name_fm(){   # Apple Intelligence (FoundationModels)
  local out
  # 1) prefer the warm daemon helper — it's resident, so no ~7s cold start
  out=$(curl -s --max-time 12 "$COCKPIT_DAEMON_URL/generate" -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg p "$_NAME_INSTR$1" --arg s "$_FM_SYS" '{prompt:$p,instructions:$s}')" \
        2>/dev/null | jq -r '.text // empty' 2>/dev/null || true)
  [ -n "$out" ] && { printf '%s' "$out"; return 0; }
  # 2) fallback: invoke the helper binary directly (cold start)
  [ -x "$COCKPIT_FM_HELPER" ] || return 0
  jq -nc --arg p "$_NAME_INSTR$1" --arg s "$_FM_SYS" '{id:1,prompt:$p,instructions:$s,temperature:0.2}' \
    | "$COCKPIT_FM_HELPER" 2>/dev/null | head -1 | jq -r '.text // empty' 2>/dev/null || true
}
_name_mlx(){
  curl -s --max-time 8 "$COCKPIT_NAMER_URL" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg p "$_NAME_INSTR$1" '{messages:[{role:"user",content:$p}],max_tokens:20,temperature:0.2}')" \
    2>/dev/null | jq -r '.choices[0].message.content // empty' 2>/dev/null || true
}
slugify(){
  local prompt="$1" out=""
  case "$COCKPIT_NAMER" in
    fm)  out=$(_sanitize_slug "$(_name_fm "$prompt")"); [ -n "$out" ] || out=$(_sanitize_slug "$(_name_mlx "$prompt")");;
    mlx) out=$(_sanitize_slug "$(_name_mlx "$prompt")");;
    *)   out="";;
  esac
  [ -n "$out" ] || out=$(printf '%s' "$prompt" | _sanitize_slug)   # fallback: ASCII letters of the prompt
  [ -n "$out" ] && printf '%s' "$out" || printf 'task-%s' "$(date +%H%M%S)"
}

# One round: branch N agents from base (empty base = current main) + broadcast prompt + assemble grid.
_run_round(){
  local prompt="$1" task="$2" base="${3:-}"
  local root; root=$(git rev-parse --show-toplevel)
  local addargs=(); for a in $COCKPIT_AGENTS; do addargs+=(-a "$a"); done
  [ -n "$base" ] && addargs+=(--base "$base")

  local before after
  before=$(tmux list-windows -F '#{window_id}' | sort)
  echo "wt: '$task' -> [$COCKPIT_AGENTS]${base:+ (base: $base)} launching..."
  workmux add "$task" "${addargs[@]}" -p "$prompt" -b >/dev/null
  sleep 1
  after=$(tmux list-windows -F '#{window_id}' | sort)
  local neww; neww=$(comm -13 <(echo "$before") <(echo "$after") || true)
  [ -n "$neww" ] || die "no new worktree windows found (workmux add failed?)"

  # Grid window: pull each agent pane in with join-pane (pane_id is stable across the move).
  local cwin ph
  cwin=$(tmux new-window -d -P -F '#{window_id}' -n "${WIN_PREFIX}:${task}")
  ph=$(tmux list-panes -t "$cwin" -F '#{pane_id}' | head -1)
  tmux set-option -w -t "$cwin" @cockpit_root "$root"
  tmux set-option -w -t "$cwin" @cockpit_prompt "$prompt"   # used as the pick auto-commit message
  while IFS= read -r w; do
    [ -n "$w" ] || continue
    local wt src
    wt=$(tmux display-message -p -t "$w" '#{window_name}')
    src=$(tmux list-panes -t "$w" -F '#{pane_id}' | head -1)
    tmux join-pane -d -s "$src" -t "$cwin"
    tmux set-option -p -t "$src" @worktree "$wt"
  done <<< "$neww"
  tmux kill-pane -t "$ph" 2>/dev/null || true
  tmux select-layout -t "$cwin" tiled
  # Full-width bottom command bar (grid compresses above it; it survives drops).
  local bar
  bar=$(tmux split-window -d -f -v -l "$BAR_HEIGHT" -t "$cwin" -P -F '#{pane_id}' \
        "printf '%s\n' '-- agentdeck wt --  in bar: agentdeck wt send \"...\"  |  on a pane (all after prefix): P=pick  F=fork  X=drop  G=grid  S=send-all  R=score'; exec \${SHELL:-/bin/zsh}")
  tmux set-option -p -t "$bar" @cockpit_bar 1
  # Non-builtin agents (agy, etc.) aren't prompt-injected by workmux -p -> deliver via send-keys.
  local sa p wt
  for sa in $COCKPIT_SENDKEYS_AGENTS; do
    while IFS=' ' read -r p wt; do
      case "$wt" in *-"$sa") sleep 1; _send_to_pane "$p" "$prompt";; esac
    done < <(tmux list-panes -t "$cwin" -F '#{pane_id} #{@worktree}')
  done
  tmux select-pane -t "$bar"
  tmux select-window -t "$cwin"
  echo "wt: grid ready."
}

cmd_broadcast(){
  need_tmux; need_repo
  local prompt="${1:-}"; [ -n "$prompt" ] || die 'start "<prompt>" [name]'
  local task="${2:-}"; [ -n "$task" ] || task=$(slugify "$prompt"); [ -n "$task" ] || task="t$(date +%H%M%S)"
  _run_round "$prompt" "$task" ""
}

# Branch a new round from the focused agent's (unmerged) WIP. No merge to main.
cmd_fork(){
  need_tmux; need_repo
  local prompt="${1:-}"; [ -n "$prompt" ] || die 'fork "<prompt>" [name]'
  local fp wt; fp=$(tmux display -p '#{pane_id}'); wt=$(pane_wt "$fp")
  [ -n "$wt" ] || die "put the cursor on the agent pane to fork from (not the bar/empty pane)"
  goto_root
  local wpath; wpath=$(workmux path "$wt" 2>/dev/null || true)
  if [ -n "$wpath" ] && [ -n "$(git -C "$wpath" status --porcelain 2>/dev/null)" ]; then
    echo "wt: committing [$wt] WIP (pinning the fork base)..."
    git -C "$wpath" add -A && git -C "$wpath" commit -q -m "wip: fork base from $wt" || true
  fi
  local task; task=$(slugify "$prompt"); [ -n "$task" ] || task="t$(date +%H%M%S)"
  echo "wt: forking from [$wt] -> new round"
  _run_round "$prompt" "$task" "$wt"
}

# Discard the current grid (review-only round, no merge). Removes worktrees + closes window.
cmd_abandon(){
  need_tmux
  local cwin; cwin=$(tmux display -p '#{window_id}')
  goto_root
  local p wt
  while IFS= read -r p; do
    wt=$(pane_wt "$p"); [ -n "$wt" ] && (workmux remove "$wt" -f || true)
  done < <(tmux list-panes -t "$cwin" -F '#{pane_id}')
  tmux kill-window -t "$cwin" 2>/dev/null || true
  echo "wt: grid abandoned (nothing merged)."
}

# Overlay ★ APME score (if any) on each grid pane border.
cmd_score(){
  need_tmux; goto_root
  local cwin; cwin=$(tmux display -p '#{window_id}')
  tmux set-window-option -t "$cwin" pane-border-status top
  tmux set-window-option -t "$cwin" pane-border-format ' #{@pane_label} '
  local p wt path sc
  while IFS= read -r p; do
    wt=$(pane_wt "$p")
    if [ -z "$wt" ]; then tmux set-option -p -t "$p" @pane_label "[ cmd ]"; continue; fi
    path=$(_wt_path "$wt")
    sc=""
    [ -f "$APME_DB" ] && sc=$(sqlite3 "$APME_DB" "SELECT printf('%.2f',composite_score) FROM runs WHERE (project_name='$wt' OR project_path='$path') AND composite_score IS NOT NULL ORDER BY started_at DESC LIMIT 1" 2>/dev/null || true)
    tmux set-option -p -t "$p" @pane_label "$wt${sc:+   ★ $sc}"
  done < <(tmux list-panes -t "$cwin" -F '#{pane_id}')
  echo "wt: ★ APME score overlay refreshed (use workmux dashboard 'd' for diffs)"
}

# Add agy (Antigravity) to the compare set: bare interactive in the global config; prompt via send-keys.
cmd_setup_agy(){
  local CFG="$HOME/.config/workmux/config.yaml"
  [ -f "$CFG" ] || die "global config not found: $CFG"
  if grep -qE '^[[:space:]]*agy:' "$CFG"; then
    sed -i '' -E 's/^([[:space:]]*agy:).*/\1 "agy"/' "$CFG"
    echo "wt: set agy -> \"agy\" (bare interactive) in the global config"
  else
    echo "  warning: add 'agy: \"agy\"' to the agents: map in $CFG"
  fi
  echo "  then: agentdeck wt agents claude codex opencode agy"
  echo "  (agy is prompted via send-keys — COCKPIT_SENDKEYS_AGENTS=agy)"
}

cmd_send(){
  need_tmux
  local text="${1:-}"; [ -n "$text" ] || die 'send "<text>"'
  local cwin; cwin=$(tmux display -p '#{window_id}')
  local n=0 p wt
  while IFS= read -r p; do
    wt=$(pane_wt "$p"); [ -n "$wt" ] || continue          # skip the bar/empty pane
    _send_to_pane "$p" "$text"
    echo "-> $wt"; n=$((n+1))
  done < <(tmux list-panes -t "$cwin" -F '#{pane_id}')
  echo "wt: sent to $n agent(s)"
}

cmd_pick(){
  need_tmux
  local cwin fp winner; cwin=$(tmux display -p '#{window_id}'); fp=$(tmux display -p '#{pane_id}')
  winner=$(pane_wt "$fp"); [ -n "$winner" ] || die "put the cursor on the winning agent pane (not the bar/empty pane)"
  local losers=() p wt
  while IFS= read -r p; do
    [ "$p" = "$fp" ] && continue
    wt=$(pane_wt "$p"); [ -n "$wt" ] && losers+=("$wt")
  done < <(tmux list-panes -t "$cwin" -F '#{pane_id}')
  goto_root
  # Auto-commit the winner's uncommitted changes (workmux merge only takes commits -> else work is lost).
  local wpath; wpath=$(workmux path "$winner" 2>/dev/null || true)
  if [ -n "$wpath" ] && [ -n "$(git -C "$wpath" status --porcelain 2>/dev/null)" ]; then
    local msg; msg=$(tmux show-options -wqv @cockpit_prompt 2>/dev/null || true); [ -n "$msg" ] || msg="wt pick: $winner"
    echo "wt: auto-committing the winner's uncommitted changes..."
    git -C "$wpath" add -A && git -C "$wpath" commit -q -m "$msg" || true
  fi
  echo "wt: winner [$winner] -> merge to main / cleanup: ${losers[*]:-(none)}"
  workmux merge "$winner" || die "merge failed (resolve conflicts)"
  local l; for l in "${losers[@]:-}"; do [ -n "$l" ] && (workmux remove "$l" -f || true); done
  tmux kill-window -t "$cwin" 2>/dev/null || true
  echo "wt: done. merged to main — keep working or start another round."
}

cmd_drop(){
  need_tmux
  local fp wt; fp=$(tmux display -p '#{pane_id}'); wt=$(pane_wt "$fp")
  [ -n "$wt" ] || die "put the cursor on the agent pane to drop (not the bar/empty pane)"
  goto_root
  echo "wt: dropping [$wt] (remove worktree + close pane, grid re-tiles)"
  workmux remove "$wt" -f || true
  tmux kill-pane -t "$fp" 2>/dev/null || true     # only the top grid re-flows; the bottom bar stays
}

cmd_setup(){
  need_tmux
  tmux bind-key S command-prompt -p 'send-all:' "run-shell \"$INVOKE send '%%'\""
  tmux bind-key P run-shell "$INVOKE pick"
  tmux bind-key X run-shell "$INVOKE drop"
  tmux bind-key G run-shell "$INVOKE grid"
  tmux bind-key F command-prompt -p 'fork-from-focused:' "run-shell \"$INVOKE fork '%%'\""
  tmux bind-key R run-shell "$INVOKE score"
  echo "wt: keybindings -> prefix+S=send-all, P=pick, F=fork, X=drop, G=grid, R=score"
  echo "  (use workmux dashboard 'd'/'a' for diff/patch review — wt does not reimplement it)"
}

# Jump to the active grid window (overlay-like "button"). Most recent one.
cmd_grid(){
  need_tmux
  local w; w=$(tmux list-windows -F '#{window_id} #{window_name}' | awk -v p="^${WIN_PREFIX}:" '$2 ~ p{print $1}' | tail -1)
  [ -n "$w" ] || die "no active grid (run 'wt start' first)"
  tmux select-window -t "$w"
}

cmd_list(){ workmux list; }

cmd_clean(){
  need_repo
  # 1) close grid windows (their panes were joined, so workmux can't track them -> kill directly)
  local w
  while IFS= read -r w; do [ -n "$w" ] && tmux kill-window -t "$w" 2>/dev/null || true; done \
    < <(tmux list-windows -F '#{window_id} #{window_name}' 2>/dev/null | awk -v p="^${WIN_PREFIX}:" '$2 ~ p{print $1}')
  # 2) remove all worktrees + their windows
  echo "wt: closing grid windows + removing all worktrees (except main)..."
  workmux remove --all -f
}

# Short aliases match the in-grid keybinding letters (b=start, s/p/f/x/a/g/r).
case "${1:-}" in
  start|broadcast|b) shift; cmd_broadcast "$@";;
  send|s)            shift; cmd_send "$@";;
  pick|p)            shift; cmd_pick "$@";;
  fork|f)            shift; cmd_fork "$@";;
  drop|x)            shift; cmd_drop "$@";;
  abandon|a)         shift; cmd_abandon "$@";;
  grid|g)            shift; cmd_grid "$@";;
  score|r)           shift; cmd_score "$@";;
  setup)             shift; cmd_setup "$@";;
  setup-agy)         shift; cmd_setup_agy "$@";;
  list|ls)           shift; cmd_list "$@";;
  clean|clear)       shift; cmd_clean "$@";;
  ""|-h|--help|help) awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "$SELF";;
  *) die "unknown command: $1 (try: agentdeck wt help)";;
esac
