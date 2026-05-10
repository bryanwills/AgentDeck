// AgentDeck landing page i18n strings
// KO (primary), EN, JA

window.AGENTDECK_I18N = {
  ko: {
    nav: {
      experience: "사용 경험",
      devices: "지원 기기",
      apme: "성능 평가",
      developers: "개발자용",
    },
    hero: {
      kicker: "App Store 심사 대기 중 · macOS 15+ / iPadOS 17+",
      title: "Stop Chatting.\nStart Steering.",
      subtitle:
        "AI 코딩 에이전트의 세션 상태 · 도구 호출 · 사용량 · 평가를 한 화면에서 확인하는 실시간 대시보드.",
      ctaPrimary: "App Store에서 받기",
      ctaPrimaryNote: "Coming soon",
      ctaSecondary: "기능 둘러보기",
      tagline: "Claude · Codex · OpenCode · OpenClaw",
    },
    pillars: {
      title: "단독 앱 한 번 설치 → 바로 쓰는 기능",
      subtitle:
        "별도 터미널 도구나 외부 서비스 없이 App Store 빌드 자체로 완결됩니다.",
      items: [
        {
          tag: "01",
          title: "실시간 세션 모니터링",
          body: "Claude Code · Codex · OpenCode 세션을 60fps 터레리움 UI로 시각화. 세션마다 크리처가 헤엄치며 idle / processing / awaiting 상태가 한눈에 보입니다.",
        },
        {
          tag: "02",
          title: "iPad · iPhone 컴패니언",
          body: "Bonjour 자동 발견 + QR 페어링. Mac에서 돌아가는 세션을 거실 iPad로 그대로 미러링. 무료, 같은 Apple ID에 묶여 있습니다.",
        },
        {
          tag: "03",
          title: "APME 성능 평가",
          body: "각 에이전트 턴을 카테고리별 루브릭으로 채점. 기본 백엔드는 Apple Intelligence Foundation Models — on-device, 무료, 네트워크 미사용.",
        },
        {
          tag: "04",
          title: "Device Preview 14종",
          body: "하드웨어 없이도 Stream Deck+ · Apple Watch · iPad · E-ink · ESP32 · Pixoo · TUI 등 14가지 화면에서 어떻게 보이는지 미리보기.",
        },
        {
          tag: "05",
          title: "음성 입력 (제로 셋업)",
          body: "Apple on-device SFSpeech로 음성 → 텍스트 → 에이전트 전송. 추가 다운로드 없이 작동하며 오디오는 기기를 떠나지 않습니다.",
        },
        {
          tag: "06",
          title: "Hook은 명시적 동의로만",
          body: "첫 실행 시 자동 설치 안 함. 설정에서 “Enable Claude Code Hooks…” 버튼을 누르고 settings.local.json을 직접 선택해야 등록됩니다.",
        },
      ],
    },
    standalone: {
      kicker: "Standalone Experience",
      title: "App Store 빌드 단독으로 무엇이 가능한가",
      body: "아래는 별도 도구 설치 없이 AgentDeck Dashboard만 받았을 때 사용할 수 있는 모든 기능입니다.",
      tableTitle: "App Store 단독 빌드의 능력",
      rows: [
        ["Mac 메뉴바 토폴로지 + 풀 대시보드", "✓"],
        ["iPad / iPhone 무료 컴패니언 페어링", "✓"],
        ["Claude · Codex 세션 hook 모니터링 (옵션)", "✓"],
        ["APME 평가 (Apple Intelligence on-device)", "✓"],
        ["음성 입력 (SFSpeech on-device)", "✓"],
        ["Anthropic Admin API 사용량 (수동 키 입력)", "✓"],
        ["Ulanzi D200H 14키 컨트롤러 (USB HID)", "✓"],
        ["Divoom Pixoo64 LED 매트릭스 (Wi-Fi)", "✓"],
        ["ESP32 상태 디스플레이 + Wi-Fi 프로비저닝", "✓"],
        ["OpenClaw Gateway 페어링 (Ed25519 + Keychain)", "✓"],
        ["14종 기기 Device Preview 갤러리", "✓"],
      ],
      caption:
        "모든 데이터는 기기에 보관됩니다. 외부 서버 송신 없음. App Sandbox 완전 준수 (Apple Review Guideline 2.5.2).",
    },
    developer: {
      kicker: "Optional Developer Toolchain",
      title: "개발자가 자체 워크플로우를 확장하고 싶다면",
      body: "AgentDeck 앱 자체는 외부 도구 설치를 요구하거나 유도하지 않습니다. 다만 Android ADB · OpenCode PTY 세션 · APME Layer 1 결정적 평가 같은 고급 자동화가 필요한 개발자는 별도의 오픈소스 CLI를 자체 환경에 설치해 사용할 수 있습니다.",
      install: "별도 CLI는 npm으로 받습니다",
      cliNote: "터미널에 익숙한 개발자만 해당. 일반 사용자에게는 필요 없습니다.",
      extensions: [
        {
          title: "Android e-ink · 태블릿 미러링",
          body: "Crema S, Pantone 6, Lenovo 태블릿에 대시보드를 ADB 리버스 터널로 송출.",
        },
        {
          title: "OpenCode 세션 모니터링",
          body: "OpenCode의 random-port 서버를 PTY 어댑터로 후킹.",
        },
        {
          title: "APME Layer 1 결정적 평가",
          body: "git diff · pnpm test · lint 결과를 Layer 2 LLM 점수와 합산.",
        },
        {
          title: "Codex / OpenCode PTY 세션 실행",
          body: "터미널에서 직접 세션을 띄우고 동시에 GUI 대시보드를 따라가게 합니다.",
        },
        {
          title: "Ulanzi TC001 LED 매트릭스",
          body: "8×32 LED 시계에 에이전트 상태를 송출 (ADB 브릿지).",
        },
        {
          title: "ESP32 펌웨어 플래시",
          body: "esptool.py를 통한 보드 펌웨어 업데이트.",
        },
      ],
      footnote:
        "이 기능들은 GitHub의 오픈소스 컴패니언 프로젝트로 제공되며, App Store 빌드와는 독립적으로 동작합니다.",
    },
    devices: {
      kicker: "Surfaces",
      title: "지원 기기 14종",
      body: "하나의 데몬, 14개 표면. 본인이 가진 하드웨어만 골라 쓰면 됩니다.",
      list: [
        { name: "Mac (메뉴바 + 윈도우)", tier: "App Store" },
        { name: "iPhone", tier: "App Store" },
        { name: "iPad", tier: "App Store" },
        { name: "Apple Watch", tier: "App Store" },
        { name: "Ulanzi D200H Deck Dock", tier: "App Store" },
        { name: "Divoom Pixoo64 LED", tier: "App Store" },
        { name: "ESP32 Round AMOLED", tier: "App Store" },
        { name: "ESP32 IPS LCD", tier: "App Store" },
        { name: "ESP32 B86 Box", tier: "App Store" },
        { name: "Elgato Stream Deck+", tier: "App Store + Elgato 앱" },
        { name: "Android 태블릿", tier: "개발자용 CLI" },
        { name: "Android E-ink Reader", tier: "개발자용 CLI" },
        { name: "Ulanzi TC001 LED 매트릭스", tier: "개발자용 CLI" },
        { name: "TUI 터미널 대시보드", tier: "개발자용 CLI" },
      ],
    },
    apme: {
      kicker: "APME",
      title: "감(感)에서 데이터로",
      body: "어떤 모델이 어떤 카테고리에 강한지 — 6개 LLM을 매일 굴리면서도 답을 내릴 수 없던 질문에, 본인 코드베이스 기준의 데이터를 만듭니다.",
      bullets: [
        "10개 카테고리 (coding · debugging · refactoring · planning · research · review · conversation · ops · multi_agent · unknown) 별 루브릭",
        "복합 점수 = 0.40 outcome + 0.40 judge + 0.15 efficiency + 0.05 vibe",
        "로컬 백엔드 전용 (MLX · Apple Foundation Models · OpenClaw Gateway) — 비용 0",
        "👍/👎 vibe 라벨로 LLM 심판이 사용자 기준에 맞게 OPRO 자동 튜닝",
      ],
    },
    privacy: {
      title: "프라이버시 · 보안",
      bullets: [
        "모든 세션 데이터는 기기에 보관, 외부 서버 송신 없음",
        "음성은 Apple on-device SFSpeech로 기기에서만 변환",
        "App Sandbox 완전 준수 (Apple Review Guideline 2.5.2)",
        "로컬 WebSocket(9120)은 같은 Wi-Fi의 페어링된 iOS 컴패니언만 수락",
        "Hook 등록은 NSOpenPanel 명시 동의 + security-scoped bookmark",
      ],
    },
    footer: {
      indep:
        "AgentDeck은 독립 프로젝트로, Anthropic · OpenAI · Google · Corsair/Elgato · DIVOOM · Ulanzi 및 본문에 언급된 어떤 제3자와도 제휴 · 후원 · 승인 관계가 없습니다. Claude™, Stream Deck®, Pixoo® 등 모든 상표는 각 소유자의 자산입니다.",
      links: ["GitHub", "Architecture", "ATTRIBUTION", "Issues"],
      built: "Built by puritysb",
    },
  },

  en: {
    nav: {
      experience: "Experience",
      devices: "Devices",
      apme: "Evaluation",
      developers: "For developers",
    },
    hero: {
      kicker: "App Store review pending · macOS 15+ / iPadOS 17+",
      title: "Stop Chatting.\nStart Steering.",
      subtitle:
        "A real-time dashboard for your AI coding agents — session state, tool calls, usage, and quality scores at a glance.",
      ctaPrimary: "Get on the App Store",
      ctaPrimaryNote: "Coming soon",
      ctaSecondary: "Tour the experience",
      tagline: "Claude · Codex · OpenCode · OpenClaw",
    },
    pillars: {
      title: "What you get from a single App Store install",
      subtitle:
        "Everything below ships with the standalone Mac + iOS app. No terminal, no external services.",
      items: [
        {
          tag: "01",
          title: "Live session monitoring",
          body: "Claude Code · Codex · OpenCode sessions render as a 60fps terrarium. Each session is a creature; idle / processing / awaiting reads instantly.",
        },
        {
          tag: "02",
          title: "iPad & iPhone companion",
          body: "Bonjour auto-discovery and QR pairing. Mirror your Mac's sessions to a tablet on the same Wi-Fi. Free, same Apple ID.",
        },
        {
          tag: "03",
          title: "APME quality scoring",
          body: "Every agent turn scored against category-specific rubrics. Default backend is Apple Intelligence Foundation Models — on-device, free, no network.",
        },
        {
          tag: "04",
          title: "Device Preview ×14",
          body: "Preview how AgentDeck looks on Stream Deck+ · Apple Watch · iPad · E-ink · ESP32 · Pixoo · TUI without owning any of the hardware.",
        },
        {
          tag: "05",
          title: "Voice input, zero install",
          body: "Press, speak, send. Apple on-device SFSpeech transcribes locally. No model download, no whisper.cpp, audio never leaves the device.",
        },
        {
          tag: "06",
          title: "Hooks are opt-in only",
          body: "Nothing is auto-installed. Settings → Enable Claude Code Hooks presents an NSOpenPanel; you pick settings.local.json yourself.",
        },
      ],
    },
    standalone: {
      kicker: "Standalone Experience",
      title: "What works with just the App Store build",
      body: "Everything in this list is available the moment you finish installing — no other tools required.",
      tableTitle: "Capabilities of the standalone build",
      rows: [
        ["Menu bar topology + full Mac dashboard", "✓"],
        ["Free iPad / iPhone companion pairing", "✓"],
        ["Claude · Codex hook-based session monitoring (opt-in)", "✓"],
        ["APME evaluation (Apple Intelligence on-device)", "✓"],
        ["Voice input (SFSpeech on-device)", "✓"],
        ["Anthropic Admin API usage (paste your own key)", "✓"],
        ["Ulanzi D200H 14-key controller (USB HID)", "✓"],
        ["Divoom Pixoo64 LED matrix (Wi-Fi)", "✓"],
        ["ESP32 status displays + Wi-Fi provisioning", "✓"],
        ["OpenClaw Gateway pairing (Ed25519 + Keychain)", "✓"],
        ["14-device preview gallery", "✓"],
      ],
      caption:
        "All data stays on-device. No remote servers. Fully App Sandbox compliant (Apple Review Guideline 2.5.2).",
    },
    developer: {
      kicker: "Optional Developer Toolchain",
      title: "If you want to extend AgentDeck yourself",
      body: "AgentDeck never requires or prompts for external tools. Developers who want advanced automation — Android ADB bridging, OpenCode PTY sessions, APME Layer 1 deterministic scoring — can install a separate open-source CLI in their own environment.",
      install: "The CLI is published on npm",
      cliNote: "Only relevant if you're comfortable with a terminal. Not needed for typical use.",
      extensions: [
        {
          title: "Android e-ink & tablet mirroring",
          body: "Push the dashboard to Crema S, Pantone 6, Lenovo tablets via an ADB reverse tunnel.",
        },
        {
          title: "OpenCode session monitoring",
          body: "Hook OpenCode's random-port server through a PTY adapter.",
        },
        {
          title: "APME Layer 1 deterministic scoring",
          body: "Combine git diff · pnpm test · lint outcomes with the Layer 2 LLM judge.",
        },
        {
          title: "Codex / OpenCode PTY launch",
          body: "Spawn agent sessions from your terminal and let the GUI follow along.",
        },
        {
          title: "Ulanzi TC001 LED matrix",
          body: "Stream agent state to an 8×32 LED clock (via ADB bridge).",
        },
        {
          title: "ESP32 firmware flashing",
          body: "Update board firmware through esptool.py.",
        },
      ],
      footnote:
        "These extensions live as a separate open-source companion project on GitHub and run independently of the App Store build.",
    },
    devices: {
      kicker: "Surfaces",
      title: "14 supported surfaces",
      body: "One daemon, 14 surfaces. Use whichever hardware you already have.",
      list: [
        { name: "Mac (menu bar + window)", tier: "App Store" },
        { name: "iPhone", tier: "App Store" },
        { name: "iPad", tier: "App Store" },
        { name: "Apple Watch", tier: "App Store" },
        { name: "Ulanzi D200H Deck Dock", tier: "App Store" },
        { name: "Divoom Pixoo64 LED", tier: "App Store" },
        { name: "ESP32 Round AMOLED", tier: "App Store" },
        { name: "ESP32 IPS LCD", tier: "App Store" },
        { name: "ESP32 B86 Box", tier: "App Store" },
        { name: "Elgato Stream Deck+", tier: "App Store + Elgato app" },
        { name: "Android tablet", tier: "Developer CLI" },
        { name: "Android E-ink reader", tier: "Developer CLI" },
        { name: "Ulanzi TC001 LED matrix", tier: "Developer CLI" },
        { name: "TUI terminal dashboard", tier: "Developer CLI" },
      ],
    },
    apme: {
      kicker: "APME",
      title: "From gut feel to data",
      body: "I route 6+ LLMs across daily work by gut feeling. Generic benchmarks don't answer 'which model wins on my codebase'. APME does.",
      bullets: [
        "Ten task categories (coding · debugging · refactoring · planning · research · review · conversation · ops · multi_agent · unknown) with dedicated rubrics",
        "Composite score = 0.40 outcome + 0.40 judge + 0.15 efficiency + 0.05 vibe",
        "Local backends only (MLX · Apple Foundation Models · OpenClaw Gateway) — zero cost",
        "👍/👎 vibe labels train the judge to your taste via OPRO auto-tuning",
      ],
    },
    privacy: {
      title: "Privacy & security",
      bullets: [
        "All session data stays on-device. Nothing is sent to remote servers.",
        "Voice is transcribed by Apple's on-device SFSpeech — audio never leaves the device.",
        "Fully App Sandbox compliant (Apple Review Guideline 2.5.2).",
        "The local WebSocket on port 9120 only accepts paired iOS companions on the same Wi-Fi.",
        "Hook installation requires explicit NSOpenPanel consent + a security-scoped bookmark.",
      ],
    },
    footer: {
      indep:
        "AgentDeck is an independent project and is not affiliated with, endorsed by, or sponsored by Anthropic · OpenAI · Google · Corsair/Elgato · DIVOOM · Ulanzi or any third party referenced. Claude™, Stream Deck®, Pixoo® and other trademarks are the property of their respective owners.",
      links: ["GitHub", "Architecture", "ATTRIBUTION", "Issues"],
      built: "Built by puritysb",
    },
  },

  ja: {
    nav: {
      experience: "体験",
      devices: "対応機器",
      apme: "評価",
      developers: "開発者向け",
    },
    hero: {
      kicker: "App Store審査中 · macOS 15+ / iPadOS 17+",
      title: "Stop Chatting.\nStart Steering.",
      subtitle:
        "AIコーディングエージェントのセッション状態・ツール呼び出し・使用量・評価を1画面で確認するリアルタイムダッシュボード。",
      ctaPrimary: "App Storeで入手",
      ctaPrimaryNote: "近日公開",
      ctaSecondary: "機能を見る",
      tagline: "Claude · Codex · OpenCode · OpenClaw",
    },
    pillars: {
      title: "App Storeから1回インストールするだけで使える機能",
      subtitle:
        "外部ツールやサービスは不要。スタンドアロンのMac + iOSアプリだけで完結します。",
      items: [
        {
          tag: "01",
          title: "セッションのリアルタイム監視",
          body: "Claude Code・Codex・OpenCodeのセッションを60fpsのテラリウムUIで描画。各セッションがクリーチャーになり、idle / processing / awaiting が一目で分かります。",
        },
        {
          tag: "02",
          title: "iPad / iPhone コンパニオン",
          body: "Bonjour自動検出 + QRペアリング。Macのセッションを同じWi-FiのiPadへ無料でミラー。",
        },
        {
          tag: "03",
          title: "APME 性能評価",
          body: "各エージェントターンをカテゴリー別ルーブリックで採点。デフォルトはApple Intelligence Foundation Models（オンデバイス・無料・ネットワーク不要）。",
        },
        {
          tag: "04",
          title: "Device Preview 14種",
          body: "Stream Deck+ · Apple Watch · iPad · E-ink · ESP32 · Pixoo · TUI など、ハードウェアを持っていなくても表示プレビューが可能。",
        },
        {
          tag: "05",
          title: "音声入力（追加インストール不要）",
          body: "Apple純正のオンデバイスSFSpeechで音声→テキスト→送信。モデルダウンロード不要、音声は端末外に送られません。",
        },
        {
          tag: "06",
          title: "Hookは明示的同意のみ",
          body: "初回起動時に自動設定はしません。設定の「Enable Claude Code Hooks…」からNSOpenPanelで自分でsettings.local.jsonを選んだ場合のみ登録されます。",
        },
      ],
    },
    standalone: {
      kicker: "スタンドアロン体験",
      title: "App Store版だけでできること",
      body: "以下はすべて、AgentDeck Dashboardをインストールした直後から利用できます。",
      tableTitle: "スタンドアロンビルドの機能一覧",
      rows: [
        ["メニューバートポロジー + フルダッシュボード", "✓"],
        ["iPad / iPhoneの無料コンパニオンペアリング", "✓"],
        ["Claude · Codex セッションのhook監視（任意）", "✓"],
        ["APME評価（Apple Intelligence オンデバイス）", "✓"],
        ["音声入力（SFSpeechオンデバイス）", "✓"],
        ["Anthropic Admin API 使用量（鍵を手動で貼付）", "✓"],
        ["Ulanzi D200H 14キーコントローラー（USB HID）", "✓"],
        ["Divoom Pixoo64 LEDマトリクス（Wi-Fi）", "✓"],
        ["ESP32ステータスディスプレイ + Wi-Fiプロビジョニング", "✓"],
        ["OpenClaw Gatewayペアリング（Ed25519 + Keychain）", "✓"],
        ["14種のDevice Previewギャラリー", "✓"],
      ],
      caption:
        "すべてのデータは端末に保存されます。外部サーバー送信なし。App Sandbox完全準拠（Apple Review Guideline 2.5.2）。",
    },
    developer: {
      kicker: "Optional Developer Toolchain",
      title: "自分でワークフローを拡張したい開発者向け",
      body: "AgentDeckアプリ自体は外部ツールのインストールを要求もしませんし、誘導もしません。Android ADB · OpenCode PTY · APME Layer 1の決定論的評価などの高度な自動化が必要な開発者は、別リポジトリのオープンソースCLIを各自の環境に入れて使えます。",
      install: "CLIはnpmで配布されています",
      cliNote: "ターミナルに慣れた開発者向け。一般用途では不要です。",
      extensions: [
        {
          title: "Android E-ink・タブレットミラー",
          body: "Crema S・Pantone 6・LenovoタブレットへADBリバーストンネルでダッシュボードを送出。",
        },
        {
          title: "OpenCodeセッション監視",
          body: "OpenCodeのランダムポートサーバーをPTYアダプタでフック。",
        },
        {
          title: "APME Layer 1 決定論的評価",
          body: "git diff · pnpm test · lintの結果をLayer 2のLLM判定と合算。",
        },
        {
          title: "Codex / OpenCode PTY起動",
          body: "ターミナルからセッションを起動し、GUIダッシュボードに同時反映。",
        },
        {
          title: "Ulanzi TC001 LEDマトリクス",
          body: "8×32 LEDクロックにエージェント状態を送出（ADBブリッジ経由）。",
        },
        {
          title: "ESP32ファームウェア書き込み",
          body: "esptool.pyによるボードファームウェア更新。",
        },
      ],
      footnote:
        "これらの拡張機能はGitHub上の別オープンソースプロジェクトとして提供され、App Store版とは独立して動作します。",
    },
    devices: {
      kicker: "Surfaces",
      title: "対応機器14種",
      body: "デーモン1つ、表示面14種。手元にあるハードウェアだけ選んで使えます。",
      list: [
        { name: "Mac（メニューバー + ウィンドウ）", tier: "App Store" },
        { name: "iPhone", tier: "App Store" },
        { name: "iPad", tier: "App Store" },
        { name: "Apple Watch", tier: "App Store" },
        { name: "Ulanzi D200H Deck Dock", tier: "App Store" },
        { name: "Divoom Pixoo64 LED", tier: "App Store" },
        { name: "ESP32 Round AMOLED", tier: "App Store" },
        { name: "ESP32 IPS LCD", tier: "App Store" },
        { name: "ESP32 B86 Box", tier: "App Store" },
        { name: "Elgato Stream Deck+", tier: "App Store + Elgatoアプリ" },
        { name: "Androidタブレット", tier: "開発者用CLI" },
        { name: "Android E-inkリーダー", tier: "開発者用CLI" },
        { name: "Ulanzi TC001 LEDマトリクス", tier: "開発者用CLI" },
        { name: "TUIターミナルダッシュボード", tier: "開発者用CLI" },
      ],
    },
    apme: {
      kicker: "APME",
      title: "勘からデータへ",
      body: "毎日6つ以上のLLMをタスクごとに振り分けているけれど、本当に最適なのか？汎用ベンチマークでは「自分のコードベース上で勝つモデル」は分かりません。APMEがそれを可視化します。",
      bullets: [
        "10カテゴリー（coding · debugging · refactoring · planning · research · review · conversation · ops · multi_agent · unknown）ごとの専用ルーブリック",
        "総合スコア = 0.40 outcome + 0.40 judge + 0.15 efficiency + 0.05 vibe",
        "ローカルバックエンド限定（MLX · Apple Foundation Models · OpenClaw Gateway）— 追加コスト0",
        "👍/👎 のvibeラベルでLLM審査員をユーザーの好みにOPRO自動チューニング",
      ],
    },
    privacy: {
      title: "プライバシーとセキュリティ",
      bullets: [
        "セッションデータはすべて端末内に保存。外部サーバー送信なし。",
        "音声はAppleオンデバイスSFSpeechで端末内のみ変換、外部に送信しません。",
        "App Sandbox完全準拠（Apple Review Guideline 2.5.2）。",
        "ローカルWebSocket（9120）は同じWi-Fi上のペア済みiOSコンパニオンのみ受け付けます。",
        "Hook登録はNSOpenPanelによる明示的同意 + security-scoped bookmark必須。",
      ],
    },
    footer: {
      indep:
        "AgentDeckは独立プロジェクトであり、Anthropic · OpenAI · Google · Corsair/Elgato · DIVOOM · Ulanziおよび本文で言及した第三者と提携・スポンサー・承認関係はありません。Claude™、Stream Deck®、Pixoo®等の商標は各社に帰属します。",
      links: ["GitHub", "Architecture", "ATTRIBUTION", "Issues"],
      built: "Built by puritysb",
    },
  },
};
