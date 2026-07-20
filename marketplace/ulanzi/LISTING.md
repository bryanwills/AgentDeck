# AgentDeck — Ulanzi Studio Marketplace listing

Submission target: **https://ugc.ulanzistudio.com** → `작품 업로드` (Upload work).
Submitted 2026-07-20; the entry sits under `개인 센터 → 내 업로드` awaiting review
(`내 게시물` stays empty until it is published).

## Upload-form requirements

Read off the portal's own form, not from documentation — Ulanzi publishes no
asset spec. Two things the form does NOT tell you up front are recorded below.

| Slot | Required | Ratio | Our file |
|---|---|---|---|
| Main file | yes | — (`.zip`, ≤50 MB/file) | `dist/agentdeck-ulanzi-v1.0.0.zip` (9.3 MB) |
| Cover image | yes | **1:1 for plugins** | `marketplace/ulanzi/1.0.0/cover-1024x1024.jpg` |
| Banner 01 | yes | 3:2 | `marketplace/ulanzi/1.0.0/banner-01-1920x1280.jpg` |
| Banner 02 | optional | 3:2 | `marketplace/ulanzi/1.0.0/banner-02-1920x1280.jpg` |
| Banner 03 | optional | 3:2 | `marketplace/ulanzi/1.0.0/banner-03-1920x1280.jpg` |

Regenerate with `node scripts/generate-ulanzi-marketplace-assets.mjs`.

### Gotcha 1 — the cover ratio is conditional

The form shows `2:1` until the main file is uploaded and recognised as a plugin,
then flips to `1:1`: "플러그인 커버는 UlanziStudio MarketPlace용으로 1:1 비율을
사용합니다." **Upload the zip first, then read the cover requirement.** Only the
1:1 file is generated; there is no 2:1 variant to pick up by mistake.

If no cover is supplied the portal auto-fills one from the plugin's own
`resources/icons/plugin.png`, so an empty-looking slot is not actually empty.

### Gotcha 3 — upload assets ONE AT A TIME

Every image upload opens an 이미지 자르기 (crop) dialog, and the file is only sent
to the server when you press 확인 in that dialog. Queue four uploads back to back
and the crop dialogs stack: the ones you never confirm stay as **local `data:`
previews**. The slot renders a perfectly normal thumbnail either way, so there is
no visual difference between "saved" and "not saved" — the submit just fails.

Verify by checking that each thumbnail's `src` is a `/cdn/uploadPath/...` URL and
not a `data:` URI. A thumbnail is not evidence of an upload.

### Known blocker — 작품 업데이트 returns 404 (Ulanzi-side, 2026-07-20)

Pressing 업데이트 클릭 fails for reasons that have nothing to do with our content.
The deployed frontend posts to `/api/api/updateAuditResources`, which the backend
answers with a plain HTTP 404 "Not Found". Evidence that this is theirs, not ours:

- A **pristine reload with zero edits** still 404s on submit.
- The JS bundle is current (`index-7TL9tKSN.js` matches a fresh fetch), so it is
  not a stale-frontend problem on our machine.
- Every other route answers: `userInfo`, `myList`, `cateList`, `dictData`,
  `upload` all 200. The record itself is fine (id 1064, status 0).
- **`/api/api/updateResources` returns 200 — `updateAuditResources` does not
  exist.** The update modal is calling a route the backend does not serve.

Nothing in this file can work around that. Re-report it to Ulanzi rather than
re-editing the listing. Do NOT hand-craft a POST to `updateResources` to force
the save: the payload contract is unknown and it would be writing to a live
listing through an API we have not verified.

### Gotcha 2 — the 1000-character cap truncates silently

`상세 소개` is capped at 1000 characters and the form **cuts the overflow without
warning**. On the 2026-07-20 pass the German (1169), Portuguese (1087) and
Spanish (1146) descriptions were all silently clipped mid-sentence, losing the
trademark disclaimer. The only visible symptom was a counter reading exactly
`1000 / 1000`. Measure every locale before pasting.

## Field limits

`이름` 40 · `요약` 1000 · `상세 소개` 1000 characters, per language.
All seven language tabs are required — an empty tab blocks submission.

## Metadata (as submitted)

- **유형 (Type)**: `插件` (plugin)
- **버전 번호**: `1.0.0`
- **카테고리**: `工具` — the five options are 直播 / 创作 / 灯光 / 办公 / 工具; there is no developer or monitoring category, so 工具 is the closest fit
- **고유 ID**: `com.ulanzi.ulanzistudio.agentdeck`
- **추가 링크**: `https://puritysb.github.io/AgentDeck/`

## Compatibility (as submitted)

- **지원 언어**: all seven — 中文 / English / Deutsch / 日本語 / 한국어 / Português / Español. The field controls "프론트엔드 표시 범위와 필터 태그", i.e. which localized listings surface, so it tracks the copy below rather than the plugin's UI language (the plugin ships only `en.json`).
- **지원 장치**: **D200H only.** The form pre-selects D200, D200H, D200X and Dial; `manifest.json` declares `Devices: ["D200H"]` and no code path handles the others, so the other three are deselected.
- **지원 시스템**: Windows · macOS (Apple Silicon) · macOS (Intel). Verified against the shipped archive, which carries `resvgjs.darwin-arm64`, `darwin-x64`, `win32-x64`, `win32-arm64` and `win32-ia32` binaries. Note the manifest's own floor (mac 10.11 / Windows 10) is optimistic — the plugin would load but find no daemon; the real floor is the daemon's, macOS 15 / Windows 11.

---

## English

### Name

```
AgentDeck
```

### Summary

```
Turn the D200H into a live control surface for AI coding agents. Session keys reflow by agent state — Claude Code, Codex, OpenCode, and OpenClaw activity, attention, prompt choices, modes, stop controls, and usage, all on your deck.
```

### Description

```
Stop Chatting. Start Steering.

AgentDeck brings your AI coding agents out of the terminal and onto the D200H. The plugin ships one dynamic action — fill your keys with it and each key reflows on its own as work happens.

Features
• Live session keys for Claude Code, Codex, OpenCode, and OpenClaw
• Distinct attention state — see which agent is waiting on you
• Prompt steering, mode toggle, and stop from the key
• Token and quota gauges with reset countdowns
• Automatic reconnect and an explicit OFFLINE state

Getting set up
A thin client — it needs the free AgentDeck daemon on the same Mac. Install it from a terminal:

    npx @agentdeck/setup

That is the whole setup. An AgentDeck app for Mac is on the way through the App Store; it carries the same daemon and removes the terminal step.

The plugin bundles no daemon, touches no USB HID, and collects no analytics.

AgentDeck is an independent project, not affiliated with any third party mentioned. All trademarks belong to their owners.
```

---

## 한국어

### Name

```
AgentDeck
```

### Summary

```
D200H를 AI 코딩 에이전트 조종석으로. 키가 에이전트 상태에 따라 스스로 재배치됩니다 — Claude Code, Codex, OpenCode, OpenClaw의 진행 상태·응답 대기·프롬프트 선택·모드·중단·사용량을 데크 위에서 바로.
```

### Description

```
AgentDeck은 AI 코딩 에이전트를 터미널 밖 D200H 위로 꺼내 놓습니다.

대화 말고 조종하세요.

플러그인이 제공하는 동적 액션은 하나입니다. 키를 이걸로 채워 두면 작업이 진행되는 대로 각 키가 알아서 바뀝니다 — 실행 중인 세션, 답을 기다리는 에이전트, 고를 프롬프트 선택지, 모드 전환, 중단 버튼, 사용량 게이지.

주요 기능
• Claude Code, Codex, OpenCode, OpenClaw 실시간 세션 키
• 응답 대기 상태를 별도 표시 — 어떤 에이전트가 기다리는지 한눈에
• 프롬프트 조종 — 키에서 바로 선택지 고르기
• 포커스된 세션의 모드 전환 및 중단
• 토큰·쿼터 게이지와 리셋 카운트다운
• 자동 재연결 및 명시적 OFFLINE 상태 표시

설치 방법
얇은 클라이언트라 같은 Mac에서 무료 AgentDeck 데몬이 실행 중이어야 합니다. 터미널에서 설치하세요.

    npx @agentdeck/setup

이게 전부입니다. 같은 데몬을 내장한 AgentDeck Mac 앱도 App Store 출시를 앞두고 있으며, 출시되면 터미널 단계가 없어집니다.

플러그인은 데몬을 내장하지 않으며, USB HID에 직접 접근하거나 분석 데이터를 수집하지 않습니다.

AgentDeck은 독립적인 프로젝트이며 언급된 어떤 제3자와도 제휴 관계가 없습니다. 모든 상표는 각 소유자의 자산입니다.
```

---

## 日本語

### Name

```
AgentDeck
```

### Summary

```
D200HをAIコーディングエージェントの操縦席に。キーはエージェントの状態に応じて自動で組み替わります — Claude Code、Codex、OpenCode、OpenClawの進行状況・応答待ち・プロンプト選択・モード・停止・使用量をデッキ上で。
```

### Description

```
AgentDeckは、AIコーディングエージェントをターミナルの外、D200Hの上に引き出します。

会話ではなく、操縦を。

このプラグインが提供する動的アクションは1つだけです。キーをこれで埋めておけば、作業の進行に合わせて各キーが自動で切り替わります — 実行中のセッション、応答を待っているエージェント、選ぶべきプロンプトの選択肢、モード切替、停止ボタン、使用量ゲージ。

主な機能
• Claude Code、Codex、OpenCode、OpenClawのリアルタイムセッションキー
• 応答待ち状態を個別に表示 — どのエージェントが待っているか一目で
• プロンプト操作 — キーから直接選択肢を選ぶ
• フォーカス中セッションのモード切替と中断
• トークン・クォータゲージとリセットまでのカウントダウン
• 自動再接続と明示的なOFFLINE表示

セットアップ
シンクライアントのため、同一Mac上で無料のAgentDeckデーモンが動作している必要があります。ターミナルからインストールしてください。

    npx @agentdeck/setup

これだけです。同じデーモンを内蔵したAgentDeck MacアプリもApp Storeで公開準備中で、公開後はターミナルの手順が不要になります。

プラグインはデーモンを同梱せず、USB HIDへの直接アクセスや解析データの収集も行いません。

AgentDeckは独立したプロジェクトであり、言及されたいかなる第三者とも提携関係はありません。すべての商標は各所有者に帰属します。
```

---

## 中文（简体）

### Name

```
AgentDeck
```

### Summary

```
把 D200H 变成 AI 编程助手的实时控制台。按键会随助手状态自动重排 —— Claude Code、Codex、OpenCode、OpenClaw 的运行状态、待回复提醒、提示选项、模式、停止和用量，全部呈现在你的 Deck 上。
```

### Description

```
别只是聊天，直接操控。

AgentDeck 把 AI 编程助手从终端里搬到 D200H 上。插件只提供一个动态动作 —— 用它铺满按键，每个键都会随着工作进展自动切换。

主要功能
• Claude Code、Codex、OpenCode、OpenClaw 的实时会话按键
• 单独标示待回复状态 —— 一眼看出哪个助手在等你
• 直接在按键上选择提示选项、切换模式、中断任务
• 令牌与配额仪表，并显示重置倒计时
• 自动重连，未连接时显示明确的 OFFLINE 状态

安装方法
本插件是瘦客户端，需要同一台 Mac 上运行免费的 AgentDeck 守护进程。在终端中安装：

    npx @agentdeck/setup

这样就完成了。内置同一守护进程的 AgentDeck Mac 应用也即将在 App Store 上线，届时无需终端步骤。

本插件不内置守护进程，不直接访问 USB HID，也不收集任何分析数据。

AgentDeck 是独立项目，与文中提及的任何第三方均无从属关系。所有商标归各自所有者所有。
```

---

## Deutsch

### Name

```
AgentDeck
```

### Summary

```
Machen Sie das D200H zur Steuerzentrale für KI-Coding-Agents. Die Tasten ordnen sich je nach Agent-Status neu an — Aktivität, Wartezustände, Prompt-Optionen, Modi, Stopp und Verbrauch von Claude Code, Codex, OpenCode und OpenClaw, direkt auf Ihrem Deck.
```

### Description

```
Schluss mit Chatten. Fangen Sie an zu steuern.

AgentDeck holt Ihre KI-Coding-Agents aus dem Terminal auf das D200H. Das Plugin liefert eine einzige dynamische Aktion — belegen Sie Ihre Tasten damit, und jede Taste ordnet sich beim Arbeiten von selbst neu.

Funktionen
• Live-Sitzungstasten für Claude Code, Codex, OpenCode und OpenClaw
• Eigener Wartezustand — Sie sehen sofort, welcher Agent auf Sie wartet
• Prompt-Auswahl, Moduswechsel und Stopp direkt von der Taste
• Token- und Kontingentanzeigen mit Countdown
• Automatischer Verbindungsaufbau und ein klarer OFFLINE-Zustand

Einrichtung
Ein Thin Client — er braucht den kostenlosen AgentDeck-Daemon auf demselben Mac:

    npx @agentdeck/setup

Mehr ist nicht nötig. Eine AgentDeck-App für Mac ist im App Store unterwegs, mit demselben Daemon.

Das Plugin enthält keinen Daemon, nutzt kein USB HID und sammelt keine Analysedaten.

AgentDeck ist ein unabhängiges Projekt ohne Verbindung zu den genannten Dritten. Marken gehören ihren Inhabern.
```

---

## Português

### Name

```
AgentDeck
```

### Summary

```
Transforme o D200H em um painel de controle ao vivo para agentes de programação com IA. As teclas se reorganizam conforme o estado do agente — atividade, espera por resposta, opções de prompt, modos, parada e uso do Claude Code, Codex, OpenCode e OpenClaw, tudo no seu deck.
```

### Description

```
Pare de conversar. Comece a pilotar.

O AgentDeck tira seus agentes de programação com IA do terminal e os coloca no D200H. O plugin traz uma única ação dinâmica — preencha suas teclas com ela e cada tecla se reorganiza sozinha conforme o trabalho avança.

Recursos
• Teclas de sessão ao vivo para Claude Code, Codex, OpenCode e OpenClaw
• Estado de espera destacado — veja qual agente aguarda você
• Escolha de prompt, troca de modo e parada direto da tecla
• Medidores de tokens e cota com contagem regressiva
• Reconexão automática e um estado OFFLINE explícito

Instalação
É um cliente leve — precisa do daemon gratuito do AgentDeck no mesmo Mac:

    npx @agentdeck/setup

É só isso. Um app AgentDeck para Mac está a caminho na App Store, com o mesmo daemon.

O plugin não embute daemon, não acessa USB HID e não coleta dados de análise.

O AgentDeck é um projeto independente, sem afiliação com terceiros mencionados. As marcas pertencem aos seus proprietários.
```

---

## Español

### Name

```
AgentDeck
```

### Summary

```
Convierte el D200H en un panel de control en vivo para agentes de programación con IA. Las teclas se reorganizan según el estado del agente: actividad, espera de respuesta, opciones de prompt, modos, parada y uso de Claude Code, Codex, OpenCode y OpenClaw, todo en tu deck.
```

### Description

```
Deja de conversar. Empieza a pilotar.

AgentDeck saca tus agentes de programación con IA de la terminal y los lleva al D200H. El plugin incluye una sola acción dinámica: llena tus teclas con ella y cada tecla se reorganiza sola a medida que avanza el trabajo.

Funciones
• Teclas de sesión en vivo para Claude Code, Codex, OpenCode y OpenClaw
• Estado de espera diferenciado: ve qué agente te está esperando
• Elección de prompt, cambio de modo y parada desde la tecla
• Medidores de tokens y cuota con cuenta atrás
• Reconexión automática y un estado OFFLINE explícito

Instalación
Es un cliente ligero: necesita el daemon gratuito de AgentDeck en el mismo Mac:

    npx @agentdeck/setup

Eso es todo. Una app de AgentDeck para Mac está en camino en la App Store, con el mismo daemon.

El plugin no incorpora daemon, no accede a USB HID y no recopila datos de análisis.

AgentDeck es un proyecto independiente, sin afiliación con los terceros mencionados. Las marcas pertenecen a sus propietarios.
```

---

## Gallery sources

Nothing is upscaled. The deck face is not screenshotted at all — it is rendered
from the canonical `buildSessionDeck` slots, which are viewBox SVG and therefore
rasterise crisp at any size (DESIGN.md R7). That replaced the previous
`d200h-app.png` composite, a 964×590 capture drawn at 1020px — a 1.06× upscale
that also filled only 53% of the 1920 canvas, making it the soft one in the
carousel.

| File | Source |
|---|---|
| `cover-1024x1024.jpg` | `buildSessionDeck` @132px/key + `design/brand/agentdeck-icon.png` + the four upstream agent marks |
| `banner-01-1920x1280.jpg` | `buildSessionDeck` @268px/key — 77% of canvas width |
| `banner-02-1920x1280.jpg` | `docs/media/d200h-hero.jpg` 4032×3024, framed on the whole deck (0.53× downscale) |
| `banner-03-1920x1280.jpg` | `docs/media/macos-dashboard.png` 2362×1430, timeline pane cropped (0.71× downscale) |

Photographic imagery is deliberately D200H-only. Desk shots that also contain an
Elgato Stream Deck were tried and rejected — a competitor's device reading as the
most legible thing in frame does not belong on Ulanzi's own storefront.

**banner-03 privacy note.** The macOS capture's bottom quarter is the live
timeline, and at storefront size its rows are legible real project chatter. The
generator crops above the timeline and fades the cut, so the banner carries only
the terrarium, session list, and quota gauges. Do not re-crop it taller.

## Release notes (v1.0.0)

First public release for the D200H. Dynamic session keys, multi-agent state and
attention rendering, prompt steering, stop and mode controls, usage views, and
reconnect behavior through the official Ulanzi Studio plugin runtime.

## Submission files

- Installable folder: `plugin-ulanzi/dist/com.ulanzi.ulanzistudio.agentdeck.ulanziPlugin/`
- Upload archive: `dist/agentdeck-ulanzi-v1.0.0.zip`
- Verification guide: `plugin-ulanzi/VERIFY.md`
