# Voice Setup

Voice input requires **sox** (audio capture) and **whisper.cpp** (local transcription).

- **arm64 Homebrew** (`/opt/homebrew/`) required on Apple Silicon — x86 Homebrew runs through Rosetta without Metal GPU (10-20x slower)
- **Binaries needed**: `rec` (from sox), `whisper-cli` and `whisper-server` (from whisper-cpp)
- **Whisper model**: `~/.local/share/whisper-cpp/` or Homebrew share dir — `large-v3-turbo` recommended (~1.5GB)
- **GPU memory**: ~1.8GB (shared across sessions, one whisper-server instance)

---

## Apple Silicon (M1/M2/M3/M4)

> **Important:** You must use **arm64 Homebrew** (`/opt/homebrew/`). The x86 Homebrew (`/usr/local/`) installs Intel binaries that run through Rosetta 2 without Metal GPU — transcription will be 10-20x slower.

```bash
# Check your Homebrew architecture
brew --prefix
# /opt/homebrew  → arm64 (correct)
# /usr/local     → x86 (need to install arm64 Homebrew)
```

If you only have x86 Homebrew:
```bash
# Install arm64 Homebrew (coexists with x86, doesn't affect it)
arch -arm64 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Add to your shell profile (~/.zshrc)
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Install with arm64 Homebrew:
```bash
/opt/homebrew/bin/brew install sox whisper-cpp
```

## Intel Mac

```bash
brew install sox whisper-cpp
```

---

## Download Whisper Model

```bash
whisper-cli --download-model large-v3-turbo   # ~1.5GB, best quality/speed balance
```

Models are saved to `~/.local/share/whisper-cpp/`. The bridge auto-selects the best available model:

| Model | Size | Speed (M1 Max, Metal) | Accuracy | Best for |
|-------|------|----------------------|----------|----------|
| `large-v3-turbo` | 1.5GB | ~3-5s for 10s audio | Excellent | Recommended for Apple Silicon |
| `small` | 466MB | ~2-3s | Good | Limited disk space |
| `base` | 148MB | ~1-2s | Fair | Fallback (auto-selected if no Metal) |

---

## Verify Setup

```bash
# Check binary is arm64 with Metal (Apple Silicon)
file $(which whisper-cli)
# → Mach-O 64-bit executable arm64  ← correct

otool -L $(which whisper-cli) | grep metal
# → libggml-metal.0.dylib  ← Metal GPU enabled
```

The bridge auto-detects Metal support at startup and logs:
```
[Voice] whisper-cli: arm64=true, metal=true (/opt/homebrew/bin/whisper-cli)
[Voice] Selected whisper model: ~/.local/share/whisper-cpp/ggml-large-v3-turbo.bin
```

---

## Bridge voice runtime

- **sox/rec** for audio capture, **whisper-server** for transcription (싱글톤 포트 9100, 세션 간 공유, `detached` 프로세스). 미설치 시 **whisper-cli** 폴백. GPU 메모리 ~1.8GB (세션 수 무관, 1 인스턴스)
- **Voice local recording**: 브리지 연결 상태와 무관하게 항상 로컬 녹음. iTerm2 `create window with default profile command`로 `rec` 실행 (iTerm2 마이크 권한 상속). `pkill -INT`로 녹음 중지. RMS 무음 감지 (threshold 0.001). 전사 결과 전달: iTerm2 최전면 → `write text`, 기타 앱 → 클립보드 복사 + 알림
- **Voice binary/model paths**: `shared/src/voice-paths.ts`에 `REC_CANDIDATES`, `WHISPER_CANDIDATES`, `MODEL_SEARCH_DIRS` 등 공유 상수 정의 — bridge/plugin 양쪽에서 import
