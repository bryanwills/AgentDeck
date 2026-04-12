# APME — Agent Performance Monitoring & Evaluation

에이전트 세션(Claude Code, OpenClaw, Codex CLI, OpenCode)의 작업 결과를 **데이터셋화**하고, 결정론적 검증 + LLM judge로 **자동 평가**하며, 사용자 피드백(vibe check)으로 judge 루브릭을 **자동 튜닝**하는 모듈. 모든 데이터는 `~/.agentdeck/apme.sqlite`에 저장되고, daemon HTTP API + WS 프로토콜로 Apple/Android/Plugin UI에 노출된다.

**비용 정책**: judge 기본 백엔드는 **로컬 MLX** (비용 0). Anthropic API는 `settings.json`에서 명시적 opt-in 필요. 오류 시 API fallback 금지 — skip 후 로그.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Sessions                           │
│  claude-code (PTY)  │  openclaw (GW)  │  codex/opencode (PTY)  │
└───────┬─────────────┴────────┬────────┴──────────┬──────────────┘
        │ hook POST            │ adapter events     │
        ▼                      ▼                    ▼
┌──────────────────────────────────────────────────────────────────┐
│  Collector  (bridge/src/apme/collector.ts)                       │
│  openRun() ──▶ ingestHook() ──▶ updateUsage() ──▶ closeRun()   │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  SQLite Store  (~/.agentdeck/apme.sqlite)                        │
│  runs │ steps │ artifacts │ evals │ rubrics │ vibe_feedback      │
│  + v_model_scorecard (materialized view)                         │
└────────┬─────────────────┬──────────────────┬────────────────────┘
         │                 │                  │
         ▼                 ▼                  ▼
   ┌──────────┐    ┌────────────┐     ┌────────────┐
   │  Runner   │    │   Tuner    │     │ Recommender │
   │ Layer 1+2 │    │ OPRO loop  │     │ scorecard   │
   └──────────┘    └────────────┘     └────────────┘
         │                                    │
         ▼                                    ▼
   ┌──────────────────────────────────────────────────┐
   │  Daemon HTTP API  (/apme/*)                       │
   │  → Apple TankStatusPanel / Android MonitorScreen  │
   │  → Stream Deck plugin / TUI dashboard             │
   └──────────────────────────────────────────────────┘
```

## File map

| File | Role |
|---|---|
| `bridge/src/apme/types.ts` | DB row TS types (Run, Step, Eval, Rubric, Vibe, Scorecard) |
| `bridge/src/apme/store.ts` | SQLite DAO — DDL, CRUD, `v_model_scorecard` view, rubric v1 seed |
| `bridge/src/apme/settings.ts` | `~/.agentdeck/settings.json` 병합 로더 + `shouldJudge()` gate |
| `bridge/src/apme/collector.ts` | 수집 경계 — session lifecycle → `runs`, hook → `steps` |
| `bridge/src/apme/runner.ts` | 평가 파이프라인 — Layer 1 (deterministic) + Layer 2 (LLM judge) |
| `bridge/src/apme/tuner.ts` | 루브릭 자동 튜닝 — disagreement 감지, shadow-eval, rubric append |
| `bridge/src/apme/recommend.ts` | 모델 추천 — scorecard 기반, budget/subscription aware |
| `bridge/src/apme/hw-sampler.ts` | macOS HW 스냅샷 — `vm_stat`, `sysctl`, `uptime` |
| `bridge/src/apme/http.ts` | Daemon HTTP routes (`/apme/*`) |
| `bridge/src/apme/index.ts` | 모듈 초기화 + re-export (`initApme()`) |
| `shared/src/protocol.ts` | WS 프로토콜 — `ApmeEvalEvent`, `ApmeScorecardEvent`, `ApmeRecommendationEvent` |

## Data schema

### runs — 한 세션 = 한 run

```
id, session_id, agent_type, model_id, project_name, project_path,
task_prompt, started_at, ended_at, input_tokens, output_tokens,
cost_usd, exit_code, git_before, git_after, hw_profile
```

`task_prompt`는 첫 `UserPromptSubmit` 훅에서 lazily capture. `git_before`/`git_after`는 `git rev-parse HEAD`. `hw_profile`은 JSON (`ApmeHwSampler.snapshot()`).

### steps — 훅 이벤트 + tool 호출 기록

```
id, run_id, ts, kind (PreToolUse|PostToolUse|Stop|...), tool_name, payload (JSON)
```

### evals — 평가 결과 (결정론 + judge + vibe 모두)

```
id, run_id, layer (deterministic|llm_judge|vibe),
metric (build_ok|tests_pass|lint_clean|intent|style|correctness|convention|overall),
score (0.0-1.0), raw (JSON), rubric_ver, judge_model, created_at
```

### rubrics — judge 루브릭 버전 관리

```
version (auto-increment), purpose, prompt, weights (JSON), created_at,
parent_ver (lineage), notes
```

v1은 store 초기화 시 자동 seed. 튜너가 새 버전을 `appendRubric()`로 추가. `getCurrentRubric('general')`은 항상 최신 버전 반환.

### vibe_feedback — 사용자 승인/거절

```
id, run_id, verdict (approve|reject|neutral), note, ts
```

### v_model_scorecard — 모델 랭킹 뷰

```sql
SELECT agent_type, model_id, COUNT(DISTINCT runs) AS runs,
       AVG(overall) AS avg_overall, AVG(tests_pass) AS avg_tests_pass,
       SUM(cost_usd) AS total_cost,
       SUM(cost_usd) / AVG(overall) AS cost_per_quality
FROM runs LEFT JOIN evals ...
GROUP BY agent_type, model_id;
```

## Wiring into the bridge

### Session bridge (`bridge/src/index.ts`)

1. `startSession()` 진입 시 `await initApme()` → `core.setApme(apme, cwd)`
2. `adapter.on('event', 'hook')` → `apme.collector.ingestHook(sessionId, event, data)`
3. `usage_info` 메타데이터 → `apme.collector.updateUsage(sessionId, snapshot)`
4. `state_changed` → `apme.collector.updateModel(sessionId, modelName)`

### BridgeCore (`bridge/src/bridge-core.ts`)

- `registerSession(agentType)` → `apme.collector.openRun()` (daemon meta-session 제외)
- `deregisterSession()` → `apme.collector.closeRun()` + `apme.runner.enqueue()`

### Daemon (`bridge/src/daemon-server.ts`)

- 부팅 시 `await initApme()` (HTTP routes용 — daemon은 run을 직접 열지 않음)
- `/apme/*` 요청 → `handleApmeRequest(req, res, apme)` 로 dispatch

## Evaluation pipeline

### Layer 1 — Deterministic

`runDeterministic(run, cfg)` in `runner.ts`:

1. `detectLanguage(projectPath)` — `package.json` → typescript, `.xcodeproj` → swift, `build.gradle*` → kotlin
2. `hasChanges(run)` — git diff 확인. 변경 없으면 skip (stale baseline 방지)
3. 명령 실행 (`spawn('sh', ['-c', cmd])`) — 각 단계별 timeout, exit code 캡처
4. 기본 명령: TS(`pnpm lint/build/test`), Swift(`xcodebuild test`), Kotlin(`./gradlew testDebugUnitTest`)
5. 결과 → `evals` 테이블에 `layer='deterministic'`, `score=0|1`

명령 override: `settings.json.apme.deterministic.commands.typescript.test = "vitest run --reporter=json"`

### Layer 2 — LLM Judge (G-Eval)

`shouldJudge(cfg.judge, layer1Passed)` 게이트 후 실행:

1. `buildJudgePrompt()` — 루브릭 prompt + task_prompt + git diff + deterministic 결과 + 메타데이터
2. `callJudge()` — 백엔드 분기:
   - `mlx` → `http://127.0.0.1:8800/v1/chat/completions` (OpenAI-compatible, 기본값)
   - `openclaw` → `http://127.0.0.1:18789/chat` (Gateway 라우팅)
   - `api` → `Error` throw (opt-in 미설정 시 명확한 에러 메시지)
3. `parseJudgeJson()` — JSON 추출 (`{...}` 패턴 매칭), 0-10 스케일 자동 정규화, 코드펜스 관용
4. 결과 → `evals` 테이블에 `layer='llm_judge'`, metrics: `intent`, `correctness`, `style`, `convention`, `overall`

게이팅 기본값: `sampleRate: 0.2`, `onlyWhenDisagreement: true` → 테스트 pass인 80%는 judge skip.

## Rubric auto-tuning

`ApmeTuner.tune()` in `tuner.ts` — OPRO(Optimization by PROmpting) 스타일:

1. **Disagreement detector**: 최근 run에서 `tests_pass=1 ∧ judge.overall<0.5` (false negative), `tests_pass=0 ∧ judge.overall>0.8` (false positive), `vibe=reject ∧ judge.overall>0.7` 등 수집
2. **Baseline correlation**: `evals.overall` ↔ `vibe_feedback.verdict` 간 Pearson 상관 계산
3. **Meta-prompt**: 현재 루브릭 + disagreement 샘플을 judge 백엔드에 보내 새 `prompt` + `weights` 제안받음
4. **Shadow-eval**: 제안된 루브릭으로 같은 샘플을 재채점, vibe와의 상관이 개선되었는지 비교
5. **Accept/reject**: 상관 개선 > 0.05 시 `rubrics` 테이블에 새 버전 append (`parentVer` 링크). 미개선 시 폐기 + 로그

자동 실행: `shouldRetune()` — vibe correlation < 0.4 이면 true. `autoTune: false`로 수동 전환 가능.

## Daemon HTTP API

| Method | Path | Description |
|---|---|---|
| GET | `/apme/runs?limit=&agent=&model=` | 최근 runs + evals + overallScore |
| GET | `/apme/run/:id` | 단일 run 상세 (steps, evals, vibe) |
| GET | `/apme/scorecard` | `v_model_scorecard` — 모델별 성공률·비용 집계 |
| GET | `/apme/rubric/current` | 현재 활성 루브릭 |
| POST | `/apme/vibe` | `{ runId, verdict, note? }` — 사용자 피드백 |
| POST | `/apme/recommend` | `{ taskKind?, budgetUsd?, preferLocal? }` → top-3 후보 |
| POST | `/apme/tune` | 수동 루브릭 튜닝 트리거 |

모든 응답은 JSON + `Access-Control-Allow-Origin: *`. APME 미초기화 시 503.

## WS protocol additions

`shared/src/protocol.ts`에 추가된 이벤트/커맨드:

**Bridge → Client (BridgeEvent)**:
- `ApmeEvalEvent` — run 평가 완료 시 broadcast (`type: 'apme_eval'`, `run: ApmeRunSummary`)
- `ApmeScorecardEvent` — 모델 스코어카드 갱신 (`type: 'apme_scorecard'`, `scorecards[]`)
- `ApmeRecommendationEvent` — 모델 추천 결과 (`type: 'apme_recommendation'`, `candidates[]`)

**Client → Bridge (PluginCommand)**:
- `ApmeVibeFeedbackCommand` — 사용자 vibe check (`type: 'apme_vibe'`, `runId`, `verdict`)
- `ApmeRecommendCommand` — 추천 요청 (`type: 'apme_recommend'`, `taskKind?`, `budgetUsd?`)

## Settings

`~/.agentdeck/settings.json` 의 `apme` 블록:

```json
{
  "apme": {
    "enabled": true,
    "autoTune": true,
    "deterministic": {
      "enabled": true,
      "timeoutSec": 180,
      "commands": {
        "typescript": {
          "lint": "pnpm lint",
          "build": "pnpm build",
          "test": "pnpm vitest run --reporter=json"
        }
      }
    },
    "judge": {
      "backend": "mlx",
      "model": "qwen3-30b",
      "sampleRate": 0.2,
      "onlyWhenDisagreement": true,
      "endpoint": "http://127.0.0.1:8800/v1/chat/completions"
    },
    "availableModels": ["claude-opus-4-6", "claude-sonnet-4-6", "qwen3-30b"]
  }
}
```

| Key | Default | Description |
|---|---|---|
| `enabled` | `true` | APME 전체 on/off |
| `autoTune` | `true` | 루브릭 자동 튜닝 활성화 |
| `deterministic.enabled` | `true` | Layer 1 (lint/build/test) 실행 여부 |
| `deterministic.timeoutSec` | `180` | 단계별 하드 타임아웃 (초) |
| `deterministic.commands` | `{}` | 언어별 명령 override |
| `judge.backend` | `"mlx"` | `"mlx"` \| `"api"` \| `"openclaw"` |
| `judge.model` | `"qwen3-30b"` | 백엔드에서 사용할 모델 id |
| `judge.sampleRate` | `0.2` | judge 호출 비율 (0..1) |
| `judge.onlyWhenDisagreement` | `true` | 결정론적 clear pass 시 judge skip |
| `availableModels` | `[]` | 추천 엔진이 필터할 가용 모델 목록 |

## HW sampler

`ApmeHwSampler.snapshot()` — macOS only, `runs.hw_profile`에 JSON 저장:

```json
{
  "platform": "darwin",
  "memTotal": 68719476736,
  "memUsed": 32145678336,
  "cpuLoad": 0.23,
  "cpuCount": 12,
  "model": "Mac14,14",
  "timestamp": 1712880000000
}
```

`sysctl hw.memsize`, `vm_stat` (active+wired+compressed pages), `uptime` load average, `sysctl hw.model`. 권한 상승 없음.

## Optional dependency

`better-sqlite3`는 bridge의 **optional** native dep. 미설치 시:

- `ApmeStore.init()` → `false` → `initApme()` → `null`
- `BridgeCore.setApme(null)` → 모든 collector 호출 no-op
- bridge 정상 부팅, APME만 비활성

설치: `pnpm install` (pnpm `onlyBuiltDependencies`에 등록됨). 모듈 해석은 `createRequire(import.meta.url)` 사용 — vitest가 repo root에서 실행돼도 `bridge/node_modules/better-sqlite3` symlink를 따라감.

## Test coverage

| File | Tests | Coverage |
|---|---|---|
| `apme-collector.test.ts` | 7 | run lifecycle, usage/model update, listRuns, rubric seed, evals, scorecard, disabled graceful |
| `apme-runner.test.ts` | 20 | detectLanguage, parseJudgeJson, shouldJudge gating, runner flow (mock det+judge), real spawn, no-changes skip, buildJudgePrompt |
| `apme-tuner.test.ts` | 18 | correlation math, parseProposal, extractOverall, disagreement collection, vibeCorrelation, tune accept/reject/unparseable/insufficient/disabled |
| `apme-http.test.ts` | 10 | 503 uninit, GET runs/run/scorecard/rubric, POST vibe/recommend, 404, agent filter |

총 55 tests. 모든 테스트는 실제 SQLite (`better-sqlite3` `createRequire` 해석) + 실제 `spawn` 명령 실행.
