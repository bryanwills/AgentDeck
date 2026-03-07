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
