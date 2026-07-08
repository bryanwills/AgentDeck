# Plugin Conventions

Stream Deck+ plugin internals — encoder LCD design, button rendering, OC Timeline panel, and cross-cutting conventions.

## Core conventions

- **Action ID pattern**: All SD actions store string IDs and use `getActionById()` — never store action object references
- **Plugin UUID**: `bound.serendipity.agentdeck` (확정 — 배포 후 변경 불가)
- **Package scope**: `@agentdeck/*` (shared, bridge, plugin, hooks, setup)
- **User data dir**: `~/.agentdeck/` — `daemon.json` (daemon port discovery), `sessions.json` (session registry), `auth-token`, `settings.json`, `timeline.json`
- **npm packages**: `@agentdeck/shared`, `@agentdeck/bridge`, `@agentdeck/setup` — public npm packages (MIT license)

## Setup-required UI

Plugin detects `agentdeck` not installed → INSTALL button → `npx @agentdeck/setup` via iTerm.

## Hook format (CRITICAL)

Claude Code v2.1+ requires 3-level nesting: `{ matcher: "", hooks: [{ type: "command", command: "..." }] }`. Old flat format `{ type, command }` silently fails. `hooks/src/install.ts` exports pure logic (`applyHooks`, `removeHooks`, `migrateHooks`) + filesystem wrappers (`installHooks`, `uninstallHooks`, `migrateHooksIfNeeded`). Bridge imports `migrateHooksIfNeeded` from `@agentdeck/hooks` (no duplication). Hook scripts use `|| true` to avoid blocking Claude when bridge is down.

## Version compatibility check

`agentdeck claude` 시작 시 Claude Code 버전 → npm registry (3s) → GitHub raw JSON fallback (3s) 순으로 호환성 조회. `bridge/package.json`의 `compatibleClaudeCode` semver range로 판정. 비호환 시 자동 `npm install -g @agentdeck/bridge@latest` + 재시작 안내. `~/.agentdeck/compatibility.json` 상태 캐시 (1시간 throttle). `--no-update-check`로 비활성화. **절대 startup을 block하지 않음** — 모든 실패 케이스는 경고 후 진행.

## Agent state detection

- **Shift+Tab** (`\x1b[Z`) for Claude Code mode switching (100ms debounce)
- **BillingType detection**: PTY `model_info` parser event의 `plan` 필드로 subscription/api/unknown 판별. API 사용자는 OAuth fetch 스킵 + session 페이지만 표시
- **Effort level detection**: PTY `/model` UI에서 `(high|medium|low) effort` 패턴 파싱. Levels: high/medium(default)/low. `"medium"`은 기본값이므로 UI 표시에서 제외 (high/low만 모델명 옆에 표시). Parser→SM→WS→Plugin/Android 전체 파이프라인

## QR code display

Usage 버튼 `qr` 페이지 — `qrcode` 라이브러리 → SVG path 렌더링 (144×144, Version 3 QR 29 modules × 4px = 116px). URL 우선순위: (1) `--remote` URL (PTY 자동감지) (2) OC Gateway `http://LAN:18789`. Bridge OutputParser가 raw ANSI에서 cursor-forward 시퀀스 제거 후 URL 추출. Push → 클립보드 복사 (`pbcopy`).

## Encoder LCD design

모든 인코더 LCD는 SVG pixmap 렌더링 (`voice-layout.json` 공용). 배경 `#0f172a`, 14px 가운데 정렬 헤더, icon+value 가운데 그룹, 2px accent bar 패턴 통일. Renderer는 `plugin/src/renderers/{name}-renderer.ts` 순수 함수로 분리. Utility 모드는 clean 영문 title + emoji icon + value 구조 통일.

### Encoder takeover wide canvas

Option/permission/diff 선택 시 E1=context 패널, E2-E4=600px wide canvas 옵션 목록 (voice text와 동일한 `translate(-i*200,0)` 슬라이싱). `renderWideOptionList()` 함수, `autoScrollToIndex()`로 선택 항목 자동 스크롤.

### Encoder takeover race guard

`takeoverGeneration` counter in `plugin.ts` — exit/enter `.then()` 콜백이 실행 시점에 이미 새 전환이 발생했으면 스킵. PROCESSING→PERMISSION 빠른 전환 시 exit 콜백이 enter 이후 layout을 덮어쓰는 레이스 방지.

## Button label intelligence

3-tier 라벨 축약 시스템 — (1) CJK-aware 픽셀 기반 줄바꿈 (`text-utils.ts`) (2) 로컬 휴리스틱 약어 (`abbreviateLabel`) (3) `claude -p --model haiku` CLI 폴백 (`label-summarizer.ts`). 1-2단계 즉시(0ms), 3단계 1-3초(캐시 200개). 약어된 버튼 우하단 `~` 표시. CJK 문자 1em, Latin 0.55em 폭 계산. Wide canvas는 충분한 가로폭이라 변경 불필요.

## OC Timeline panel (Phase 4 complete)

OpenClaw 세션 상세 뷰(detail view) 진입 시 E2+E3 합체 400px 와이드 캔버스로 이벤트 타임라인 표시. 리스트 뷰에서는 일반 option/usage dial 유지. 배경 `#000000` (LCD 네이티브 블랙 — 투명 효과). Fisheye 렌더링 (font size 15→10px, opacity 1.0→0.3 보간), grouped entries (연속 중복 60s 윈도우 내 병합), detail mode (push 토글). `timeline-store.ts` 싱글톤, `timeline-renderer.ts` SVG 렌더러. 이벤트 `~/.agentdeck/timeline.json` 디스크 영속, 재연결 시 `events.history` RPC로 오프라인 이벤트 복구. OC Response 버튼: GATEWAY (웹 UI) + GO ON (continue) 프리셋.

### 시각 3계층

1. `typeColor()` 이벤트 타입별 컬러 코딩 (green/blue/amber/red/cyan/purple), 하단 2px 활동 밀도 바
2. **Gateway 어댑터가 단일 source** — `bridge/src/adapters/openclaw.ts`가 RPC 이벤트(`chat`/`tool.*`/`error`)를 직접 timeline entry로 변환. 과거 `log-stream.ts`의 `openclaw logs --follow --json` 휴리스틱 파싱 경로는 중복/오분류(`memory|recall|search` / `tool|exec|execute|command` 광범위 regex가 무관 로그를 fake event로 합성)를 일으켜 retire (커밋 `8c3a4278`). `BridgeLogStream`은 호환을 위해 no-op stub만 남음
3. Usage 버튼 `oc-usage` 페이지 (`openclaw status --usage --json` 60s 폴링)

### Bridge→Android relay

`shared/src/timeline.ts`에 `TimelineEntry` 타입 + `parseLogLine()`(이제 `chat_message` / `error` / cron 요약 같은 **구조화된** 패턴만 인식; 휴리스틱 word-match는 제거됨) 공유. Bridge OpenClaw 모드에서 `BridgeTimelineStore` + Gateway 어댑터 → `timeline_event`/`timeline_history` BridgeEvent로 WS broadcast. Adapter가 chat tracking (prompt/duration/tools) → rich `chat_start`/`chat_end`/`tool_request`/`chat_response` 이벤트 생성. Android `StateTimelineGenerator`는 bridge timeline 수신 시 로컬 생성 억제 (`receivingBridgeTimeline` 플래그).

### Timeline enrichment pipeline

1. Gateway `chat` delta에서 `message.content[].text` 추출 (`extractMessageText()`) → `accumulatedResponse` 축적
2. 20~200자 축적 시 `extractTopicHint()` → `chat_start` 업데이트 (프롬프트 없는 cron/웹 작업용)
3. Final에서 `chat_response` (응답 전문) + `chat_end` (도구/시간 요약) 생성
4. async `summarizeResponse()` → MLX qwen (port 8800, `/no_think`) → Ollama fallback → 한국어 1줄 요약으로 `chat_end` enrichment

Bridge(daemon)에서만 요약 수행 — plugin은 daemon 경유 단일 경로. LLM 실패 시 60s TTL 후 재시도 (영구 disable 방지). ConnectionManager `FORWARDED_EVENTS`에 `timeline_event`/`timeline_history` 포함.

**Claude Code LLM 요약**: OpenClaw과 동일하게 `Stop` hook에서 `summarizeResponse()` → `upsertEntry()`로 chat_end async enrichment. `extractTopicHint()` 개선 — code fence 내부 스킵, markdown decorator 제거.

**Detail 클리닝**: `shared/src/timeline.ts`의 `cleanDetailText()` — markdown artifact(bold/heading/fence/link), JSON blob(connectionId 등 시스템 JSON 필터, error 추출), blank line 축소. OpenClaw adapter + Claude Code bridge에서 detail 저장 전 적용.

**parseLogLine 필터 개선** (역사적): broad 키워드 필터(`/whatsapp/i`, `/WebSocket error/i`, `/network_error/i`) → subsystem/module 기반 필터(`isChannelInfra` 플래그)로 전환. WhatsApp API 작업 시 tool/error 로그가 필터되는 false-positive 방지. `isChannelInfra` 분기는 `parseLogLine`에 남아 있지만, 휴리스틱 word-match로 fake `tool_exec`/`memory_recall`을 합성하던 코드는 `8c3a4278`에서 제거됐다.

**Store-level repetitive dedup**: `isRepetitiveEntry()` (shared) — `extractSemanticCore()` (chat_end: 첫 ` · ` 이전) + `extractKeywords()` keyword bag 유사도 (60% overlap threshold). 일반 엔트리 1시간 윈도우, `automated: true` 엔트리 8시간 윈도우 (content 비교 없이 automated끼리 즉시 중복 판정). 반복 시 `repeatCount` 증가 + paired chat_start도 repetitive 검증 후 제거. `deduplicateEntry()` (shared) — 텍스트 정제 → exact dedup(5s) → semantic dedup 순서, Bridge + Plugin store 공용.

**Automated tagging**: `TimelineEntry.automated?: boolean` — adapter에서 `!lastPrompt` (cron/web/channel 발 채팅)일 때 `true` 태깅. chat_start/chat_end/aborted/upsert 모두 전파. Gateway 프로토콜에 `trigger` 필드 없어 `lastPrompt` null 여부가 유일한 신호.

**텍스트 정제**: `cleanRawText()` (inline **bold**/heading/link/backtick strip), `cleanNopMarkers()` (NOP/NOOP 제거). Store 입구에서 raw/detail 양쪽 일괄 적용.

**폴백 라벨 개선**: cron/web 시작 `'Prompt sent'` → `'자동 작업'`, LLM 실패 시 `'Completed'` → `extractTopicHint(response)` 폴백 (응답 첫줄 topic 사용).

**mergeHistory dedup**: plugin `mergeHistory()` (bridge 재연결 시 `timeline_history` 수신)에 `deduplicateEntry()` 적용 — 기존 exact `ts:type:raw` 매칭만으로는 semantic dedup 우회됨.

**parseLogLine cron 요약**: cron list 테이블 행 (UUID 패턴)을 감지, error 상태만 `"Cron error: {name}"` 한 줄로 요약 표시 (ok/skipped는 스킵). `{"event":...}` JSON blob, 5자 미만 fragment도 필터.

### Android timeline UI

`TimelineStore.kt` — `GroupedEntry` + `groupConsecutive()` (plugin 로직 포팅, 60s/10s 윈도우). `TimelineEntry.status` 필드 추가. `TimelineStrip.kt` — two-pane Logbook (65% compact log + 35% detail panel), `typeIcon()` unicode 기호 (▶/■/✓/✗/⚠/◆), status-aware tool_request 아이콘. `EinkEventLog.kt` — 14개 표시 (8→14), `typeIcon()`, grouping, detail 2줄 지원.

### Timeline `detail` 필드

`TimelineEntry.detail?: string` (shared→plugin→android 관통). **Source-rich, Client-truncate 원칙**: raw 최대 500자, detail 최대 1000자로 source에서 넉넉히 전달. 각 클라이언트가 자체 truncation. Tablet `TimelineStrip`: detail 있으면 9sp dimmed 2nd line.

## D200H HID module

Ulanzi D200H communicates via **stock HID protocol** (VID `0x2207`/PID `0x0019`, same as D200). No ADB, no firmware modification, no on-device agent. 1024-byte fixed packets (header `0x7C7C` + cmd + len + payload), ZIP chunking for `SET_BUTTONS`. Device boots into HID mode after 4s. D200H returns `DeviceType:"D200"` — protocol-compatible with D200 community libraries (`strmdck`).

**Session icon invariant**: Session controls show AgentDeck's terrarium creatures, not provider/company logos. Stream Deck/Stream Deck+ SVG slots and D200H Swift PNG tiles render the same reduced creature language: Claude robot, Codex cloud prompt, OpenClaw crayfish, OpenCode nested square. Provider logos stay in brand/settings contexts only.

**Primary path: Ulanzi Studio plugin.** The D200H needs the Mac **Ulanzi Studio** app to render reliably, so the official Ulanzi Studio plugin (`plugin-ulanzi/`, registers over WS as `ulanzi-plugin`) is the **only** supported way to drive the device. It shares the `@agentdeck/shared` `buildSessionDeck` layout engine and shows an OFFLINE + press-to-launch screen when the daemon is down.

**Direct-HID fallback — retired (2026-06-21); Node side deleted (2026-07-08).** The daemons no longer open the D200H over HID.

- **Node.js CLI daemon**: the direct-HID module (`bridge/src/modules/d200h-module.ts`) and its protocol/renderer (`bridge/src/d200h/hid-protocol.ts`, `image-renderer.ts`) were **deleted** — the daemon had already gated them off (`d200h: false`) so they were dead at runtime. The `d200h` key was also dropped from `ModuleConfigs`. D200H connectivity is now reported purely from `ulanzi-plugin` WS presence (`WsServer.getUlanziClientCount()` → `/devices` `ulanziPluginConnected`, module-health `modules.d200h`, `agentdeck devices`). To restore direct-HID on the Node side, recover the deleted files from git history.
- **Swift daemon** (`D200hHidModule.swift`, macOS app): **unchanged — still dormant.** `DaemonServer.swift` gates instantiation behind `let enableD200hDirectHID = false`, so the IOKit `IOHIDManager` is never created and `d200hModule` stays `nil`.

The Swift `ulanzi-plugin` stand-down arbitration (`onUlanziPluginPresence` / `setExternalOwner`) remains in place as inert dormant code alongside the Swift direct-HID path.

**OFFLINE brand mark.** When the daemon is down, the Stream Deck keypad, Stream Deck+ encoder, and D200H all render the canonical **AgentDeck dome-over-deck brand mark** (aquarium-tide cyan on ink) — parity with the macOS/iOS/Android connection overlays and the ESP32 splash. SVG SSOT: `renderAgentDeckMark()` + the `'agentdeck'` glyph + the `'brand'` tone in `shared/src/svg-renderers/session-slot-renderer.ts` (ported from `AgentDeckLogo.swift`). All offline paths route through it (`renderDisconnectedSlot` / `renderOpenAppGrid`/`Quadrant` / `renderOfflineTouchStrip`; D200H `buildSessionDeck` hero; plugin `response`/`voice` dial tiles).

Legacy on-device C agent archived to `zkswe/agent-archive/`.

## Display sleep/wake sync

`DisplayMonitor` → `display_state` BridgeEvent → all devices dim/restore. Node daemon fuses python3 `CGDisplayIsAsleep()` 2s poll with fallback `pmset IODisplayWrangler`, `ioreg` lock/session presence, and `ScreenSaverEngine` polling; Swift daemon mirrors this as a display + lock + screensaver + session-active aggregator. `displayOn=true` means the user is present and the host display is on. `DISPLAY_FORWARDED_EVENTS` includes `display_state` (auto-propagates to `SERIAL_FORWARDED_EVENTS`).

- **Pixoo**: `setBrightness(0)` + stream pause (saves HTTP), wake restores `dev.brightness`
- **SD+ Plugin**: `displayDimmed` flag → black SVG on all buttons/LCDs, wake → `broadcastStateUpdate()` re-render, `broadcastStateUpdate()` guard skips while dimmed
- **Apple iOS**: `DisplaySyncService` — `UIScreen.main.brightness` save/0/restore, background queuing, disconnect safety restore, Settings toggle
- **Android**: `BrightnessController.dim()/restore()` — LCD: `WRITE_SETTINGS` 특수 권한 필수 (manifest 선언만으로 부족, `adb shell appops set dev.agentdeck WRITE_SETTINGS allow` 또는 Settings UI에서 "Modify system settings" 허용 필요, 앱 재설치 시 초기화됨), brightness→0 + SCREEN_OFF_TIMEOUT→2s. `MainActivity` also drops `FLAG_KEEP_SCREEN_ON` when host display is off and dim mode is full-off (including legacy events without `dim`) so tablets can actually sleep; `min` mode keeps the window awake at low brightness. E-ink keeps the screen awake by design and dims only frontlight/backlight via sysfs `/sys/class/backlight/{device}/brightness` dynamic probe (`KNOWN_BACKLIGHT_DEVICES`) — Crema S(warm/white) 동작, **Pantone 6 sysfs는 SELinux 차단으로 dim 스킵** (proc `/proc/aw99703/led_*`도 앱 context에서 읽기/쓰기 불가, root 필요)
- **ESP32**: event delivered via serial, firmware handler TBD
