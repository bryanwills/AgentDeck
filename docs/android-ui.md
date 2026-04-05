# Android UI/UX Vision

두 디바이스에서 동일한 에이전트 정보를 시각화. 정보 구성은 일관, 표현 방식만 다름. 빌드/기기 레퍼런스는 [android.md](android.md) 참조.

## 표시 정보 (공통)

- **Agent Identity**: 에이전트 타입, 세션명, 현재 모델, 상태 (IDLE/PROCESSING/AWAITING 등)
- **Event Log**: 에이전트 활동 이벤트 요약 (tool call, model call, state change)
- **Account/Connection**: OAuth 연동 상태 (connected/disconnected), billingType, bridge connection status
- **Usage Gauges**: 5h/7d rate limit % + 리셋까지 남은 시간, tokens, cost, uptime
- **Ollama Status**: ollama 프로세스 상태 (running/stopped) + 실행 중 모델 목록
- **Creature Animation**: 도트/픽셀 아트 형태의 에이전트 캐릭터 애니메이션

## E-ink (Crema) 레이아웃 — 좌측 에이전트 + 우측 아쿠아리움 중심

Row(fillMaxSize): 좌측 에이전트 패널 | 우측 아쿠아리움+정보

```
[AgentDeck 로고]          🐙        🦞
[claude-code]          (octopus)  (crayfish)
[  opus-4]           ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿
[  ● PROCESSING]
[openclaw]           RATE LIMITS              MODELS
[  gpt-4o]           5h [████░░] 72% 1h      OAuth: opus-4, sonnet-4
[  ● ROUTING]        7d [██░░░░] 63% 2d      Ollama: qwen2.5:7b 4.5G
[Workers: 2]         10:32 [T] Read file_path.ts
⚙ Settings           10:33 [M] Model call opus-4
                     10:33 [S] IDLE → PROCESSING
```

- 좌측(22%): AgentDeck 로고 + 에이전트 목록 (primary + siblings + gateway-detected)
- 우측(78%): 아쿠아리움 수조(상단 40-50%) + context/status(중간, PROCESSING시만) + 타임라인(하단 35-38%)
- IDLE시 context 숨김 → 수조 50% + 상태바 13% + 타임라인 37%. PROCESSING시 context 없으면(OpenClaw 등) IDLE과 동일 레이아웃
- **Status 2-column**: LIMITS(30%, Unicode 블록 게이지 `█░`) | MODELS(70%, OAuth catalog + Ollama). 세로 구분선, `Arrangement.Center` 수직 가운데 정렬
- 수조: Compose `clip(RoundedCornerShape)` 둥근 모서리 (내부 테두리 없음), 수면 파도, 해초, 자갈, 거품 — 수족관 느낌
- **Multi-agent visibility**: Bridge `/health`에서 sibling state 조회, Gateway TCP probe로 OpenClaw 감지. Daemon primary는 agent list에서 제외 (coding agent 아님). OpenClaw primary는 목록에 🦞로 표시하되 terrarium octopus에서는 제외 (crayfish가 담당)
- **Crayfish 독립 상태**: sibling OpenClaw session의 state에서 ROUTING/SITTING 결정 (primary agentType 의존 제거)
- **Refresh zones**: 좌측 A2(200ms), 수조 `EinkAnimatedRefreshZone`(callback 기반), context+status A2(200ms), timeline A2(300ms), IDLE status DU(2000ms). `LAYER_TYPE_SOFTWARE` on wrapper FrameLayout for EPD grayscale. 수조 애니메이션: `EinkTerrariumView.onFrameRendered` 콜백 → animation frame=GC16 partial(플래시 없음), state transition=FULL GC16(고스팅 클리어)
- **EPD vendor API**: Rockchip RK3566 (Crema S) — `android.os.EinkManager` system service, `setMode("2"=GC16/"12"=A2/"14"=DU)` + `sendOneFullFrame()`. Onyx — `BaseDevice.setViewDefaultUpdateMode()`. KOReader `RK35xxEPDController` 참고
- **E-ink grayscale**: 네이티브 16-level 그레이, `DitherEngine.snapToNearestGray()` (에러 디퓨전 없음). 수조 내부 테두리 없음 — Compose `clip(RoundedCornerShape)` 만 사용. 크리처 부위별 그레이: body(0x44), limb/claw(0x33), starburst(0x99), sleeping=dimmed. 환경: sand(0xCC), fish body(0x55)+stripe(0xBB), rock outline(0x22), seaweed 2px. 멀티세션 Y stagger: `standingOffset = (centerXFraction - 0.38) * 0.10`
- **Color e-ink (Kaleido 3)**: MOAAN Pantone 6 등 컬러 e-ink 지원. `EinkDetector.isColorEink()` + `einkPick(gray, color)`. **테라리움은 정적 렌더** (애니메이션 비활성화) — Kaleido CFA가 매 프레임 색상 재계산하여 깜빡임 유발. 상태 변경 시만 컬러 프레임 1회 렌더. UI 텍스트(게이지/타임라인/라벨)는 컬러 적용 (갱신 빈도 낮음). 컬러 팔레트: octopus terracotta `#C07058`, crayfish red `#CC3333`, tetra blue `#3366AA`+cyan `#55CCEE`, seaweed green `#336633`, sand `#D4B896`, water `#C8DDE8`. `snapToNearestGray` 컬러 모드에서 스킵 (RGB 보존). `manufacturer="rockchip"` (not "moaan"), `model="Pantone6"`

## Tablet (Lenovo) Monitor 레이아웃 — 수족관 + HUD 오버레이

- 전체 화면: 컬러 수족관 배경 (60fps 애니메이션)
- 반투명 HUD 패널로 동일 정보 오버레이
- 상단: 프로젝트명, 상태, 모델
- 좌측: Activity(현재 작업) + Multi-Agent(세션 목록)
- 우측: Engine — rate limits + **reset times**, **OAuth**, **ollama**, tokens/cost
- 하단: Timeline strip (이벤트 로그)

## Creature Design — 도트 아트 통일

- **OctopusCreature** (Claude Code): SVG path (claudecode.svg Antigravity, viewBox 24×24), terracotta, EvenOdd fill rule (눈은 투명 cutout). Android: Compose `PathParser` + `drawPath`. Apple: `CGPath` + `FillStyle(eoFill: true)`. **E-ink: `drawRect` 12×8 픽셀 그리드** (`canvas.drawPath()` e-ink Canvas 미지원 — silent fail). ESP32/TUI: 12×8/14×5 픽셀 그리드 유지. **E-ink 렌더링 제약**: `canvas.drawPath()`, `Path.op()` 등 복잡 Path 연산은 e-ink Canvas에서 silent fail → `drawRect`/`drawCircle`/`drawOval`/`drawLine` 기본 프리미티브만 사용. E-ink Cloud(Codex)는 단일 `drawOval` pill 실루엣 (이전 6-lobe clover는 각 원 개별 stroke로 seam 노출 → 단일 타원으로 대체), Crayfish도 `drawOval`+`drawLine` 조합. E-ink Cloud/OpenCode Y는 state 기반: WORKING만 layout swim slot 사용, FLOATING/SLEEPING은 지면 근처(Cloud ~0.56, OpenCode ~0.60)로 안착 — idle 세션이 상층에 떠있지 않도록. Standing 상태: per-instance `standingJitter` + X-correlated depth offset로 자연스러운 멀티세션 배치. **크리처 타입별 배치 분리**: Octopus homeX `0.20-0.50` (좌측), Cloud `0.30-0.55` (중앙), OpenCode `0.45-0.68` (우측), Crayfish `0.75-0.78` (최우측). Idle Y 지면 근접: Oct 0.62, Cloud 0.60, OC 0.61, Crayfish 0.64 (sand 0.65 바로 위). Swim Y 분리: Cloud 상층(0.05-0.25), OpenCode 중상층(0.25-0.50), Octopus 중층 `0.18~0.55 X`, `0.15~0.55 Y`. Pixoo: sand px54 기준 배치, HUD(px57)와 3px gap
- **CrayfishCreature** (OpenClaw): SVG Path 기반 front-facing 렌더링, red/teal gradient, `PathParser` + `withTransform` pivot rotation. SITTING: heartbeat glow (4초 주기 더블펄스), ROUTING: full animation (claw clap, signal waves, eye flash, glow pulse), SICK: 탈색+기울기+늘어진 집게+흐린 눈 (gateway 에러 시). `currentPosition()` + `isRouting()` — DataParticleSystem에 위치/상태 제공
- **Neon Tetra**: 14마리 2개 무리(schoolId 0/1, 7마리씩), Lissajous 경로 school centers로 만남/흩어짐 반복. Boids: cohesion/alignment=같은 무리만, separation=전체. `SCHOOL_ATTRACTOR_WEIGHT=0.4` (먹이 있으면 무효). `TETRA_SWIM` 경계 `0.03~0.92 X`, `0.08~0.68 Y`. E-ink: 12마리 2무리(6+6), size `0.013f`, `einkPrevFishX` heading 추적, STREAMING시 에이전트 인력 30% + 데이터 파티클 4개. **가재 반응**: ROUTING 가재도 food crumb 산란 + school center 30% 인력 → 옥토퍼스 없을 때(OpenClaw primary) 가재가 물고기 유도
- 독립 애니메이션 가능한 부위별 셀 타입 분리 (눈, 팔/집게, 다리 등)
- 상태 애니메이션: 셀 좌표 오프셋, 색상 lerp, pivot 기반 회전 (SVG transform 아님)

## Launcher app

`android/` — Jetpack Compose, minSdk 29, CATEGORY_HOME, NSD mDNS discovery, QR pairing (CameraX + ML Kit), e-ink detection (Crema/Onyx/Kobo).

**3-tab nav**: Dashboard (terrarium bg + HUD overlay panels, connection overlay when disconnected) / Deck (encoder strip + 2×4 button grid + context area) / Settings. MonitorService: CPU wake lock + system stay-on + screen wake on state change (e-ink).

**Deck encoder strip**: 4-panel LCD mirroring (Utility/Action/Session/Voice), touch gestures (swipe=rotate, tap=push, long-press=record).

**Deck button grid**: Bridge `button_state` 프로토콜 우선, 로컬 fallback. CompactStatusBar(36dp) 상단 + 직사각형 버튼(80dp) + 넓은 ContextArea. 터치 피드백(scale 0.95+alpha 0.85), AWAITING시 전체 옵션 리스트 항상 표시, PROCESSING시 LinearProgressIndicator, IDLE시 suggestedPrompt AssistChip.

**Voice**: Android AudioRecord → WAV → HTTP POST `/voice/transcribe` → whisper.

**Utility proxy**: `bridge/src/utility-proxy.ts` — osascript macOS volume/brightness/media control via Android remote.

**Slot map**: Plugin reports SD+ profile layout → Bridge caches → Android mirrors dynamically.
