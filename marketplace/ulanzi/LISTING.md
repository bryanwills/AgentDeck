# AgentDeck — Ulanzi Studio Marketplace listing

Submission target: **https://ugc.ulanzistudio.com** → `작품 업로드` (Upload work).

## Upload-form requirements

Confirmed from the portal's upload form on 2026-07-19. The portal states aspect
ratios only — it crops on upload and publishes no pixel minimums — so the sizes
below are ours.

| Slot | Required | Ratio | Our file |
|---|---|---|---|
| Main file | yes | — (`.zip`, ≤50 MB/file) | `dist/agentdeck-ulanzi-v1.0.0.zip` (9.1 MB) |
| Cover image | yes | 2:1 | `marketplace/ulanzi/1.0.0/cover-1920x960.jpg` |
| Banner 01 | yes | 3:2 | `marketplace/ulanzi/1.0.0/banner-01-1920x1280.jpg` |
| Banner 02 | optional | 3:2 | `marketplace/ulanzi/1.0.0/banner-02-1920x1280.jpg` |
| Banner 03 | optional | 3:2 | — not supplied |

Regenerate with `node scripts/generate-ulanzi-marketplace-assets.mjs`.

Banner imagery is deliberately D200H-only. `docs/media/d200h-session-buttons.jpg`
(the full desk) was tried and rejected for a banner slot: it renders the D200H as
a small dark strip while an Elgato Stream Deck reads as the most legible device in
frame — not what belongs on Ulanzi's own storefront.

## Field limits

`이름` 40 · `요약` 1000 · `상세 소개` 1000 characters, per language.

The form carries seven language tabs (中文 / English / Deutsch / 日本語 / 한국어 /
Português / Español). We supply the three we already maintain elsewhere — English,
Korean, Japanese — and leave the rest to the portal's fallback.

## Metadata

- **Type**: Plugin
- **Version**: `1.0.0`
- **Category**: plugin categories require a unique ID — confirm with Ulanzi at `ustudioservice@ulanzi.com` if the form offers no suitable existing one
- **Supported systems**: Windows · macOS (Apple Silicon) · macOS (Intel)
- **Supported languages**: English, 한국어, 日本語

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
• Distinct attention state — see at a glance which agent is waiting
• Prompt steering — pick an option straight from a key
• Mode toggle and interrupt/stop for the focused session
• Token and quota gauges with reset countdowns
• Automatic reconnect and an explicit OFFLINE state

Requirements
A thin client: it needs the free AgentDeck macOS app or daemon running on the same machine. It bundles no daemon, does not touch USB HID, collects no analytics, and never modifies your shell config.

AgentDeck is an independent project, not affiliated with or endorsed by any third party mentioned. All trademarks belong to their owners.
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

요구 사항
AgentDeck은 얇은 클라이언트입니다. 같은 기기에서 무료 AgentDeck macOS 앱 또는 AgentDeck 데몬이 실행 중이어야 합니다. 데몬을 내장하지 않으며, USB HID에 직접 접근하거나, 분석 데이터를 수집하거나, 셸 설정을 변경하지 않습니다.

AgentDeck은 독립적인 프로젝트이며 Ulanzi, Anthropic, OpenAI 및 언급된 기타 제3자와 제휴 또는 승인 관계가 없습니다. 모든 상표는 각 소유자의 자산입니다.
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

動作要件
AgentDeckはシンクライアントです。同一マシンで無料のAgentDeck macOSアプリ、またはAgentDeckデーモンが動作している必要があります。デーモンを同梱せず、USB HIDへの直接アクセス、解析データの収集、シェル設定の変更は行いません。

AgentDeckは独立したプロジェクトであり、Ulanzi、Anthropic、OpenAIおよび言及されたその他の第三者と提携または承認関係はありません。すべての商標は各所有者に帰属します。
```

---

## Release notes (v1.0.0)

First public release for the D200H. Dynamic session keys, multi-agent state and
attention rendering, prompt steering, stop and mode controls, usage views, and
reconnect behavior through the official Ulanzi Studio plugin runtime.

## Submission files

- Installable folder: `plugin-ulanzi/dist/com.ulanzi.ulanzistudio.agentdeck.ulanziPlugin/`
- Upload archive: `dist/agentdeck-ulanzi-v1.0.0.zip`
- Verification guide: `plugin-ulanzi/VERIFY.md`
