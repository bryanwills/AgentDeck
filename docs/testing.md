# Testing Guide

AgentDeck uses 4 test frameworks across its monorepo. All TypeScript packages use [Vitest](https://vitest.dev/); Android uses JUnit + Robolectric; Apple uses XCTest; ESP32 uses Robot Framework.

## Quick Start

```bash
pnpm test                        # Run vitest (646 tests)
pnpm test -- --watch             # Watch mode
pnpm vitest run --coverage       # Coverage report + threshold check
pnpm test:report                 # Unified report across all frameworks
pnpm test:android                # Android JUnit tests only
bash scripts/test-report.sh --report   # Report from existing results (no execution)
```

## Test Structure

### Vitest (TypeScript — bridge, plugin, shared, hooks)

```
bridge/src/__tests__/
  adapter.test.ts              # Adapter factory, MonitorAdapter, ClaudeCode lifecycle, OpenClaw protocol
  bridge-core.test.ts          # BridgeCore orchestration, state building, usage broadcast
  cursor-sync.test.ts          # OutputParser + StateMachine cursor tracking
  daemon-lifecycle.test.ts     # Daemon singleton guard, session registry, PID validation
  esp32-serial-node.test.ts    # Serial bridge protocol, event filtering, JSON messages
  output-parser.test.ts        # ANSI parsing, mode detection, spinner, markdown (~95KB)
  server-integration.test.ts   # HookServer + WsServer + StateMachine integration
  session-registry.test.ts     # daemon.json paths, process alive checks
  state-machine.test.ts        # State transitions, timeouts, billing, permission modes
  tier3-integration.test.ts    # mDNS crash recovery, display sync, voice transcription
  timeline-integration.test.ts # Timeline store dedup, enrichment pipeline
  usage-relay.test.ts          # 3-tier usage relay (HTTP/WS/direct)

plugin/src/__tests__/
  connection-integration.test.ts  # Real WS servers, Bridge/Gateway priority
  connection-manager.test.ts      # ConnectionManager with mocked BridgeClient
  gateway-client.test.ts          # OpenClaw Gateway WS, Ed25519 auth
  option-scenario.test.ts         # 6-option SELECT, button layout
  text-utils-and-labels.test.ts   # CJK width, text wrapping, label abbreviation

shared/src/__tests__/
  protocol-contract.test.ts    # BridgeEvent JSON shape (5 client platforms)
  timeline.test.ts             # cleanDetailText, dedup, parseLogLine, keyword similarity

hooks/src/__tests__/
  install.test.ts              # Hook installation, v2.1+ matcher-group format
```

### Android (JUnit + Robolectric)

```
android/app/src/test/kotlin/dev/agentdeck/
  net/ProtocolTest.kt          # parseBridgeMessage (all event types), PluginCommands, edge cases
  state/TimelineStoreTest.kt   # addEntry dedup, upsert, groupConsecutive, merge, MAX_ENTRIES
  state/SessionMetricsTest.kt  # connect/disconnect lifecycle, reconnect counting
  util/TimeFormatUtilsTest.kt  # formatCount, gaugeBar, formatBytes, formatDurationCompact
```

Requires JDK 17. Run with:

```bash
cd android && JAVA_HOME=$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home ./gradlew testDebugUnitTest
```

### Apple (XCTest)

```
apple/AgentDeckTests/
  ProtocolTests.swift          # BridgeEventParser parsing
  TimelineTests.swift          # Timeline entry decoding + grouping + store
```

### ESP32 (Robot Framework)

```
esp32/robot/tests/
  01_build.robot               # PlatformIO build validation, binary size (no hardware)
  02_flash_and_boot.robot      # Device flash, boot messages, heap/PSRAM (hardware required)
  03_serial_protocol.robot     # JSON protocol, state_update, error recovery (hardware required)
```

Run with `bash esp32/robot/run.sh build` (no hardware) or `bash esp32/robot/run.sh all` (full).

## Coverage

### Thresholds

Coverage thresholds are configured in `vitest.config.ts` and enforced in CI:

| Metric | Threshold |
|--------|-----------|
| Lines | ≥ 18% |
| Functions | ≥ 16% |
| Branches | ≥ 14% |
| Statements | ≥ 18% |

These are regression guards set below current levels. Raise them as coverage improves.

### Current Coverage by Package

| Package | Lines | Statements | Status |
|---------|-------|-----------|--------|
| **shared/src** | ~53% | ~53% | Core timeline + protocol well-covered |
| **bridge/src** | ~26% | ~26% | Core logic covered, device/TUI/voice gaps |
| **plugin/src** | ~23% | ~22% | Connection/text covered, actions/renderers gaps |
| **hooks/src** | indirect | indirect | Tested via install.test.ts |

Generate a report:

```bash
pnpm vitest run --coverage       # Terminal summary + lcov + json-summary
```

### Well-Tested Areas

- **State Machine** — transitions, timeouts, permission/option/diff flows, billing detection
- **Output Parser** — ANSI parsing, mode detection, spinner events, cursor sync
- **Adapter Hierarchy** — factory, ClaudeCode/OpenClaw/Monitor capabilities, Gateway protocol, lifecycle events
- **Timeline** — `parseLogLine()`, `cleanDetailText()`, semantic dedup, keyword similarity, groupConsecutive
- **Connection Manager** — Bridge/Gateway priority, failover, event forwarding
- **Hook Installation** — v2.1+ matcher-group format, migration, idempotency
- **Android Protocol** — all BridgeEvent types parsed, PluginCommands JSON generation
- **Android State** — TimelineStore dedup/upsert/merge, SessionMetrics lifecycle

### Known Gaps

| Area | Files | Reason |
|------|-------|--------|
| **Plugin actions** | 9 action handlers | Heavy SD SDK dependency |
| **SVG renderers** | 10 renderer files | Visual output — snapshot testing TBD |
| **TUI dashboard** | 6 files | Terminal rendering — visual inspection |
| **Device modules** | adb, serial, mdns, pixoo | Hardware-dependent |
| **Voice system** | voice, whisper, TTS | Audio hardware + external process |
| **Daemon server** | daemon-server.ts | Requires full process lifecycle |
| **Android UI** | 31 Compose files | Compose UI testing framework TBD |
| **Android terrarium** | 20 creature/env files | Canvas rendering — screenshot testing TBD |
| **Apple app** | 41 Swift files | Most modules untested |

## Unified Test Report

`scripts/test-report.sh` collects results from all 4 frameworks into a single summary:

```bash
bash scripts/test-report.sh              # Run all + report
bash scripts/test-report.sh --report     # Report only (from existing results)
bash scripts/test-report.sh --vitest     # Vitest only
bash scripts/test-report.sh --android    # Android only
bash scripts/test-report.sh --apple      # Apple XCTest only
bash scripts/test-report.sh --robot      # Robot Framework only
```

Output includes:
- Terminal table with pass/fail/skip per suite
- JSON summary at `coverage/test-report/summary.json`
- Vitest JSON at `coverage/test-report/vitest.json`
- Robot HTML report at `coverage/test-report/robot/report.html` (if run)

## CI Pipeline

GitHub Actions runs on every push and PR to `master`:

```yaml
# .github/workflows/ci.yml
- pnpm install --frozen-lockfile
- pnpm build
- pnpm typecheck
- pnpm test                    # vitest (646 tests)
- npx vitest run --coverage    # coverage threshold check
```

Android and Apple tests are not yet in CI (require JDK/Xcode runners). Robot Framework requires physical hardware.

Release workflows (Android, Apple) are tag-triggered and do not run tests.

## Writing Tests

### Conventions

- Place tests in `{package}/src/__tests__/{module}.test.ts`
- Use `vi.mock()` for external dependencies (node-pty, ws, fs, child_process)
- Use `vi.useFakeTimers()` for timeout/interval testing
- Import from source with `.js` extension (ESM)
- Android tests in `android/app/src/test/kotlin/dev/agentdeck/` mirroring source structure

### Mocking Patterns

```typescript
// Module mock (node-pty, express, http, ws)
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

// HTTP server mock (include closeAllConnections for shutdown)
vi.mock('http', async () => {
  const actual = await vi.importActual<typeof import('http')>('http');
  return {
    ...actual,
    createServer: vi.fn(() => ({
      listen: vi.fn((_p, _h, cb) => cb()),
      close: vi.fn((cb) => cb()),
      closeAllConnections: vi.fn(),
      on: vi.fn(),
    })),
  };
});

// Function spy
const handler = vi.fn();
emitter.on('event', handler);
expect(handler).toHaveBeenCalledWith(expected);

// Fake timers
vi.useFakeTimers();
vi.advanceTimersByTime(5000);
vi.useRealTimers();
```

### Test Helpers

- `bridge/src/__tests__/helpers/mock-adapter.ts` — Generic adapter mock
- `bridge/src/__tests__/helpers/temp-data-dir.ts` — Isolated temp filesystem for daemon/registry tests
- `bridge/src/__tests__/helpers/ws-test-client.ts` — WebSocket client simulation

### Priority for New Tests

When adding tests, prioritize by impact:

1. **Shared types/utils** — contract between packages, highest ROI
2. **State machine transitions** — core correctness
3. **Parser logic** — data transformation accuracy
4. **Protocol handling** — client-server contract
5. **Android state/network** — cross-platform parity
6. **Renderers** — snapshot tests if visual regressions matter
