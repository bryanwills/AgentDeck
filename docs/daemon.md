# Daemon Hub Architecture

The daemon is the **sole hub** for all dashboard clients. Session bridges never advertise mDNS or serve external WS/SSE — all external devices connect via daemon only.

## Port ownership

Daemon owns port **9120** (default, fallback to 9121+ if occupied by non-daemon). All dashboard clients (Android, Apple, ESP32, TUI, Plugin) connect exclusively to daemon. Session bridges use ports 9121–9139 for internal hook HTTP only (`AGENTDECK_PORT` env var injected into Claude process).

`~/.agentdeck/daemon.json` stores `{ port, pid, startedAt, httpPort? }` for local client discovery (written on daemon bind, removed on shutdown). Remote clients discover via mDNS (daemon only advertises `_agentdeck._tcp`).

## Server implementations

- **Node.js daemon**: single `http.createServer()` handles HTTP + WS upgrade on one port
- **Swift daemon**: single raw TCP `NWListener` — detects HTTP vs WebSocket upgrade per connection, manual WebSocket frame parsing (RFC 6455 GUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`), Bonjour `NWListener.Service` attached to same listener for mDNS. `getpwuid(getuid())` for real home directory (bypasses App Sandbox container path redirect). `httpPort` in `DaemonInfo` for mixed setups where HTTP ≠ WS port (nil when unified)

## Daemon singleton guard

3단계 — (1) `readDaemonInfo()` from `~/.agentdeck/daemon.json` (PID alive 검증) (2) `findExistingDaemon()` from `sessions.json` fallback (3) `probeDaemonHealth()` HTTP `/health` probe (port에 응답하는 daemon 감지). `daemon-server.ts` + `cli.ts` + `daemon.ts`(legacy) 세 곳에서 체크. 기존 daemon 있으면 `process.exit(0)` (LaunchAgent KeepAlive 재시작 루프 방지). 이중 daemon으로 인한 Gateway 이벤트 중복 relay, mDNS 충돌, timeline 중복 방지. Port occupied by non-daemon → auto-fallback to next available port.

## Shutdown timeout

`httpServer.close()` + 5s `setTimeout(() => process.exit(0))` — CLOSE_WAIT connections from disconnected clients can block `close()` callback indefinitely, causing zombie daemons (session bridge has 3s failsafe in `index.ts`).

## Whisper-server

Uses fixed singleton port **9100** (`~/.agentdeck/whisper-server.json` info file for discovery, last session exit kills server).

## Session timeline relay

`SessionTimelineRelay` (`session-timeline-relay.ts`) — daemon subscribes to sibling session bridges' WS to relay `timeline_event`/`timeline_history` events + `state_update.modelCatalog` (Claude Code OAuth catalog → daemon `cachedModelCatalog`, merged with Gateway catalog by name dedup). 10s sync interval detects new/removed sessions. Eliminates client-side `StateTimelineGenerator` duplication (Android/Apple) — daemon provides unified timeline stream for all agent types.

## mDNS crash recovery + IP change detection

`bonjour-service` multicast errors (`EADDRNOTAVAIL` on sleep/wake, WiFi reconnect, VPN toggle) are caught in `bridge-core.ts` `uncaughtException` handler. `invalidateMdnsInstance()` nulls the Bonjour instance, then `mdns.ts` recovery timer (30s interval) detects null + LAN IP available → re-publishes `_agentdeck._tcp` service automatically. Recovery timer also detects IP changes (DHCP renewal) and re-publishes with the new IP. Session bridges never advertise mDNS (`cli.ts` hardcodes `mdns: false`). **Apple discovery**: `BridgeDiscovery.swift` ignores TXT `ip` field (can be stale from Bonjour cache) and always uses `NWConnection` endpoint resolution for live IP. iOS waterfall: mDNS first → savedUrl fallback after 4s (same as macOS).

## Daemon usage relay

Daemon `fetchUsageRelayed()` — (1) sibling bridge `GET /usage` HTTP 중계 (2) WS 연결로 `usage_update` 이벤트 수신 (3) sibling 없을 때만 직접 API. Sibling 있으면 직접 API 호출 안 함 (429 방지). Bridge `hook-server.ts` `GET /usage` 엔드포인트 (no auth, local only).

## Gateway connection 격리

Daemon이 Gateway adapter의 `connection` 이벤트를 WS 클라이언트에 포워딩하지 않음 — 클라이언트가 자신의 bridge 연결 끊김으로 오인하는 버그 방지. Gateway 상태는 `state_update.gatewayAvailable`과 `sessions_list`로 전달. `disconnectGatewayAdapter()`도 `connection:disconnected` 미전송.

## Gateway health check

`checkGatewayHealth()` in `gateway-probe.ts` — `openclaw doctor --json` 30초 간격 폴링. warn/error 감지 시 `gatewayHasError: true`를 `state_update`에 포함. Android 가재가 SICK 상태로 전환 (탈색, 기울기, 늘어진 집게). Gateway 미접속 시 폴링 스킵. OpenClaw adapter도 Gateway WS `health` 이벤트를 `gateway_health` metadata로 emit → daemon이 실시간 반영 (폴링 대체).

## isDaemonLike 패턴

모든 클라이언트(TUI/Android/Apple)에서 세션 목록 렌더링 시 `agentType == 'daemon' || sessions.any { it.agentType == agentType }` 체크. daemon이 Gateway 연결 시 `agentType='openclaw'`로 브로드캐스트하므로 sessions_list에 동일 타입이 있으면 daemon 모드로 처리 (primary 스킵, sessions만 렌더). 이 없으면 session bridge 모드 (primary + siblings 렌더).

## Focus relay authority

- **Terrarium creature focus relay 중복 방지**: Focus relay가 sibling state_update를 broadcast하면 client `state.sessionId`가 sibling id로 바뀌고 `agentType`도 변경됨 → primary 크리처 추가되는데 siblings 리스트에 동일 id가 남아있어 이중 렌더. `TerrariumState.toTerrariumState()`에서 `primaryIsOctopus && $0.id == sessionId` 필터 적용 (octopus/jellyfish/opencode 모두)
- **MLX mlxModels focus relay override**: focus relay broadcast 핸들러가 modelCatalog/ollamaStatus는 daemon 캐시로 덮어쓰지만 mlxModels는 pass-through → 오래된 sibling bridge(필터 없음)가 nanoLLaVA 리스트 전송 시 깜빡임. Focus relay의 `setBroadcast`에서 `state_update`의 `mlxModels`를 항상 daemon's `cachedMlxModels`로 덮어쓰기

## Multi-surface monitoring

- mDNS (`_agentdeck._tcp`, daemon only), auth token (`~/.agentdeck/auth-token`), SSE (`/sse`), remote WS token validation
- `0.0.0.0` binding for LAN access
- `isLocalConnection()` recognizes localhost + machine's own IPs via `os.networkInterfaces()` — same-machine clients (macOS app, localhost) bypass token auth
- **Client discovery**: Local clients (TUI, CLI, session bridge) read `~/.agentdeck/daemon.json` for port. Remote clients (Android, Apple) use mDNS — only daemon advertises, so no preference logic needed
- **macOS App Sandbox**: `LocalSessionDiscovery` (sessions.json 직접 읽기) 불가 — sandbox가 `~/.agentdeck/` 접근 차단. macOS는 mDNS로 daemon 발견 (daemon만 광고하므로 단순)
- **Client count for polling**: `BridgeCore.hasClients()` = WS clients + external serial connections (`setExternalClientCountProvider`). All polling guards (sessions_list, usage, API) use `hasClients()` so ESP32 serial-only connections keep data flowing
- **ESP32 daemon state**: `isDaemon = agentType == "daemon" || "openclaw"` — daemon sends "openclaw" when gateway alive, renderer maps per-session octopus states from `sessions_list`. Multi-octopus particles (round-robin spawn from octStates[]), bubbles (exhale from all), session name dedup (`#1`/`#2`)

## Supporting files

- `bridge/src/mdns.ts` — `bonjour-service` mDNS 광고 (`_agentdeck._tcp`), daemon only
- `bridge/src/auth.ts` — `~/.agentdeck/auth-token` 32-char hex 토큰, local bypass, constant-time validation
- `bridge/src/session-registry.ts` — `daemon.json` port discovery (`writeDaemonInfo`/`readDaemonInfo`/`removeDaemonInfo`/`findDaemonPort`/`probeDaemonHealth`)
- `bridge/src/hook-server.ts` — SSE (`/sse`), `/health` (includes `mode` field), `/status`, 토큰 인증
- `bridge/src/ws-server.ts` — remote WS 연결 토큰 검증 (4001 거부), local bypass
