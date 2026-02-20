# AgentDeck Development Log

---

## 2026-02-21 — Billing-Aware Usage Display

### 문제

Usage 정보 체계가 subscription(Claude Max)과 API(pay-per-use) 사용자를 구분하지 않음:
- **Subscription**: OAuth API로 5h/7d rate limit 조회 가능. 토큰 단위 과금 없음.
- **API**: OAuth 토큰 없음 → 5h/7d 페이지가 항상 "--". PTY에서 파싱한 session 데이터만 유의미.
- `/cost` 명령어는 Claude Code에 존재하지 않아 실행 시 오류 발생.

### 해결

#### billingType 프로토콜 추가

- `BillingType = 'subscription' | 'api' | 'unknown'` 타입 신규 정의
- `StateUpdateEvent`, `StateSnapshot`에 `billingType` 필드 추가
- **Files**: `shared/src/protocol.ts`, `shared/src/states.ts`

#### Bridge — billingType 감지 및 전파

- `StateMachine`이 `model_info` 파서 이벤트의 `plan` 값으로 판별:
  - `plan`에 "Max" 포함 → `'subscription'`
  - `plan`에 "api" 포함 → `'api'`
  - 그 외 → `'unknown'` (기본값)
- state broadcast, 클라이언트 초기 연결, 스냅샷 모두에 billingType 포함
- `billingType === 'api'`이면 OAuth `fetchUsageFromApi()` 호출 전면 스킵 (on-demand, on-connect, 주기적 refresh)
- **Files**: `bridge/src/state-machine.ts`, `bridge/src/index.ts`, `bridge/src/types.ts`

#### Plugin — 조건부 페이지 표시

- `getPages()`가 billingType 기반 분기:
  - `'api'`: `['session']`만 (5h/7d/extra 무의미)
  - `'subscription'` / `'unknown'`: 기존대로 5h → 7d → extra → session
- **Files**: `plugin/src/plugin.ts`, `plugin/src/actions/usage-button.ts`

#### Quick Command 수정

- `/cost` → `/usage` 교체 (존재하지 않는 명령 제거)
- **File**: `plugin/src/actions/command-dial.ts`

### 테스트

- billingType 감지 테스트 9건 추가 (64 tests / 3 suites)
  - default unknown, subscription 감지 (case-insensitive), api 감지 (case-insensitive)
  - 미인식 plan, plan 미제공, 후속 model_info에서 billingType 유지, state_changed 이벤트 포함 확인
- **File**: `bridge/src/__tests__/state-machine.test.ts`

### Commits

| Hash | Message |
|------|---------|
| `29480bf` | feat: billing-aware usage display and /cost → /usage fix |
| `df12264` | test: add billingType detection tests for state machine |

---

## 2026-02-21 — 초기 코드 리뷰 및 버그 수정

### SDK 레퍼런스 정리

- Elgato Stream Deck SDK v2 공식 문서(docs.elgato.com)와 plugin-samples(GitHub) 전수 학습
- 핵심 내용을 `memory/streamdeck-sdk.md`에 정리 (manifest 스키마, 6개 built-in 레이아웃, 레이아웃 아이템 타입, API 메서드)
- `CLAUDE.md`에 References 섹션 추가

### 버그 수정 (5건)

#### 🔴 `response-button.ts` — `onWillDisappear` arguments 버그
- **Problem**: `onWillDisappear()` 파라미터 없이 `arguments[0]?.action?.id` 접근 → 항상 `undefined`
- **Effect**: 버튼이 사라져도 `contexts` 배열에서 제거 안 됨 → stale 항목 누적, ghost 렌더 시도
- **Fix**: `onWillDisappear(ev: WillDisappearEvent)` 파라미터 추가, `ev.action.id` 사용
- **Why**: TypeScript class method는 `arguments` 객체를 가지지 않음 (strict mode에서 undefined)

#### 🟡 `session-button.ts` — IDLE 상태 렌더마다 동기 파일 I/O
- **Problem**: `renderSessionSvg()`의 `IDLE` case에서 `readFileSync`로 sessions.json 읽음
  - `updateSessionButton()`이 호출될 때마다 (5초 usage 틱 포함) 파일 I/O 발생
- **Fix**: `updateSessionButton()`에서 IDLE 상태 전환 시(`!wasIdle`) 1회만 로드
- **Why**: 세션 목록은 cycle/reconnect 시점에만 바뀜. 렌더마다 읽을 필요 없음

#### 🟡 `pty-manager.ts` — `write()` throw → 브리지 crash 가능
- **Problem**: PTY 종료 후 플러그인 명령 도착 시 `throw new Error` → 브리지 프로세스 crash
- **Fix**: `debug log + return` (graceful drop)
- **Why**: PTY exit과 WS message 수신 사이 race condition은 정상적으로 발생 가능

#### 🟠 `output-parser.ts` — SPINNER_CHARS에 브라유 점자 포함
- **Problem**: `/[✢✳✶✻✽⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/` — 브라유 10자는 npm/yarn 등 다른 CLI 스피너
  - Claude Code 스피너는 `✢✳✶✻✽` 5자만 사용 (PTY 디버그 출력으로 확인)
- **Fix**: 브라유 제거, Claude Code 전용 5자만 유지
- **Why**: 잘못된 chars가 매칭되면 실제로 오동작하지 않지만, 의미상 오류이며 미래 혼동 방지

#### ⚪ `layout-manager.ts` — `STOP_BUTTON`/`STOP_DIM` 데드코드
- **Problem**: v2에서 넘어온 상수 — v3에서 STOP은 독립 `stop-button.ts`가 담당
- **Fix**: 두 상수 삭제

---

## 2026-02-21 — 프로젝트 리브랜딩 (AgentDeck)

### 앱 이름 확정: AgentDeck

- **Decision**: 프로젝트명 `StreamDeck-Claude` → `AgentDeck`
- **Why**: 마켓플레이스 배포를 고려했을 때 Anthropic 공식 앱처럼 보이지 않아야 함. AgentDeck은 독자적 제품명.
- **Scope**: 폴더명, GitHub 레포, package.json 이름, README/CLAUDE.md, 스크립트 출력 문자열

### Plugin UUID 확정: `bound.serendipity.agentdeck`

- **Initial**: `com.anthropic.claude-code` → (1차) `bound.serendipity.claude-code` → (최종) `bound.serendipity.agentdeck`
- **Why**: UUID는 Stream Deck 생태계의 영구 식별자. 공개 배포 전에 제품명과 일치시키는 것이 필수. 이후 변경 불가(기존 유저 프로필 파손).
- **Scope**: `manifest.json`, 8개 action `@action({ UUID })`, `rollup.config.mjs`, `tsconfig.json`, `scripts/`, sdPlugin 디렉터리명

### pnpm 패키지 스코프 확정: `@agentdeck/`

- **Initial**: `@streamdeck-claude/shared`, `@streamdeck-claude/bridge` 등
- **Final**: `@agentdeck/shared`, `@agentdeck/bridge`, `@agentdeck/plugin`, `@agentdeck/hooks`
- **Why**: 패키지명이 앱명과 일치해야 빌드 출력과 로그가 명확해짐
- **Scope**: 5개 `package.json`, 모든 TS import 경로, `pnpm-lock.yaml` 재생성

### 사용자 데이터 디렉터리

- **Initial**: `~/.streamdeck-claude/sessions.json`
- **Final**: `~/.agentdeck/sessions.json`
- **Files**: `bridge/src/session-registry.ts`, `plugin/src/actions/session-button.ts`

### GitHub 레포 생성

- URL: https://github.com/puritysb/AgentDeck
- 로컬 폴더: `/Users/puritysb/github/AgentDeck`

---

## 2026-02-21 — Hook 포트 동적 해석 + 연결 안정성 강화

### 🔴 Hook 포트 하드코딩 버그 수정 (Critical)

- **Problem**: Claude Code hooks가 `localhost:9120`으로 하드코딩됨. 2개 이상 세션 동시 실행 시 2번째 세션의 hooks가 잘못된 브리지(9120)로 POST → 상태 추적 완전히 깨짐
- **Fix**: hook 명령을 `localhost:${AGENTDECK_PORT:-9120}`으로 변경. 브리지가 Claude 프로세스 spawn 시 `AGENTDECK_PORT` 환경변수 주입
- **Files**: `hooks/src/install.ts`, `bridge/src/pty-manager.ts` (extraEnv 파라미터), `bridge/src/index.ts` (env 전달)
- **Migration**: install/uninstall 필터가 old(`localhost:9120`)와 new(`AGENTDECK_PORT`) 패턴 모두 매칭

### Hook 자동 마이그레이션

- **Problem**: 기존 사용자가 `git pull && pnpm build` 후 hooks를 수동 재설치해야 하는 상황
- **Fix**: 브리지 시작 시 `settings.local.json`을 읽어 old-format hooks 감지 → 자동으로 env var 포맷으로 in-place 마이그레이션
- **Files**: `bridge/src/index.ts` (`migrateHooksIfNeeded()`)

### TCP 포트 프로브

- **Problem**: `findAvailablePort()`가 `sessions.json` 레지스트리만 확인. 외부 프로세스가 포트 점유 시 충돌
- **Fix**: `net.createServer()`로 실제 TCP 바인드 시도하여 포트 가용성 검증. 함수를 async로 변환
- **Files**: `bridge/src/session-registry.ts` (`isPortFree()`, `findAvailablePort()` async화), `bridge/src/index.ts` (await 추가)

### State Machine 안정성 강화

- **Stuck timeout**: PROCESSING, AWAITING_PERMISSION, AWAITING_OPTION, AWAITING_DIFF 상태에서 5분간 변화 없으면 자동으로 IDLE 복구
- **Strict transitions**: 유효하지 않은 전환은 log + skip (기존: log + 실행). `transitions` 테이블에 없는 전환 차단
- **Files**: `bridge/src/state-machine.ts`, `shared/src/states.ts` (stuck_timeout 전환 추가)

### Graceful Shutdown on Crash

- **Problem**: `uncaughtException`/`unhandledRejection` 시 세션이 `sessions.json`에 stale 잔류
- **Fix**: 두 핸들러에서 `shutdown()` 호출 → 세션 정상 해제
- **Files**: `bridge/src/index.ts`

### Session Registry 강화

- **24h TTL**: `pruneDeadSessions()`에서 PID alive 체크 외에 24시간 초과 세션도 제거 (PID 재사용 방어)
- **Atomic write**: `writeSessions()`가 임시 파일에 쓴 뒤 `renameSync()`로 원자적 교체. 동시 쓰기 시 파일 손상 방지
- **Files**: `bridge/src/session-registry.ts`

### 유닛 테스트 도입

- **Framework**: vitest (workspace root)
- **55 tests / 3 suites**:
  - `state-machine.test.ts` (30): 전환, strict validation, 모든 active 상태 stuck timeout, parser events, snapshot
  - `session-registry.test.ts` (11): pruning (dead PID, 24h TTL), port allocation, atomic write
  - `install.test.ts` (14): install/uninstall, 멱등성, old-format migration, non-AgentDeck hook 보존
- **Run**: `pnpm test`

### README 리브랜딩

- 한국어 → 영어 전면 재작성
- 브랜드 보이스 ("Stop Chatting. Start Steering."), 아키텍처 다이어그램, 기능 테이블, v3 레이아웃, 멀티에이전트 로드맵 섹션

### Commits

| Hash | Message |
|------|---------|
| `3a42ef0` | fix: dynamic hook port resolution for multi-session support |
| `1530ed9` | fix: auto-migrate old hooks + TCP port probe for findAvailablePort |
| `46fafcd` | docs: rewrite README for AgentDeck rebrand |
| `2e250a5` | fix: AWAITING_* stuck timeout + atomic sessions.json writes |
| `48aea1e` | test: add unit tests for state machine, session registry, and hooks |
