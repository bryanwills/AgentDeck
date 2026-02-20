# AgentDeck Development Log

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
