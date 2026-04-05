# D200H Current Status

This file consolidates the D200H work that was previously split across
`DISPLAY_RESEARCH.md`, `PROMPT.md`, `DEVELOPMENT_LOG.md`, and the agent code.

## Sources Reviewed

- `DEVELOPMENT_LOG.md`
- `zkswe/DISPLAY_RESEARCH.md`
- `zkswe/PROMPT.md`
- `bridge/src/adb-reverse.ts`
- `apple/AgentDeck/Daemon/Modules/AdbModule.swift`
- `zkswe/agent/src/framebuffer.c`
- `zkswe/agent/src/fb_test.c`
- `zkswe/recon/d200h-maps-dump.sh`

## What Has Been Tried

### ADB / startup persistence

- Repeated `adb shell` sessions were unstable on D200H.
- Current understanding: D200H `adbd` reliably tolerates the first shell
  session after detection, but later shell sessions may hang.
- `adb reverse` commands against D200H are risky and should be skipped.
- Node bridge strategy: `adb push` first, then one combined foreground
  `adb shell` that:
  - locks `/sys/class/zkswe_usb/zkswe0/{functions,enable}`
  - bind-mounts `/bin/zkgui` and `/bin/zkdisplay` to `/dev/null`
  - kills stock UI processes
  - starts `/data/agentdeck-dyn --stdin`

### Buttons

- `/dev/hidg1` looked promising at first but turned out to reflect zkgui's
  outbound HID writes, not the real button path.
- GPIO matrix scanning via sysfs is the confirmed direction.
- Known rows: `4, 5, 6, 9, 85`
- Known columns: `0, 1, 84`
- Scanner implementation exists in `zkswe/agent/src/buttons.c`.
- Full 14-key physical calibration is still incomplete.

### Display

- `fbdev` mmap/write succeeded technically but never reached the visible layer.
- `MI_DISP` GetBuf/PutBuf returned success without visible output.
- Successful path:
  - load `libmi_sys.so` and `libmi_gfx.so` with `RTLD_GLOBAL`
  - use `MI_GFX` against bus alias `0x50101000`
  - treat page0 as visible, page1 as staging
  - software render into page1, then `MI_GFX_BitBlit(page1 -> page0)`
- `zkswe/agent/src/framebuffer.c` already implements this layout.
- `zkswe/agent/src/fb_test.c` contains focused probes for `--gfx`, `--copy-test`,
  and `/proc/*/maps` inspection.

## Main Mismatch Found

- Docs and code showed that `MI_GFX` was the correct render path.
- But the deploy/runtime path still often preferred the static musl agent,
  which cannot use `dlopen(libmi_gfx.so)` and therefore falls back to
  `/dev/mem` or fbdev behavior.
- This made the system behave as if display rendering were still unresolved,
  even though the dynamic path had already been found.

## Improvements Applied

### Node bridge

- `bridge/src/adb-reverse.ts` now prefers `agentdeck-d200h-dyn` first.
- D200H remains excluded from `adb reverse`.

### Agent build/deploy

- `zkswe/agent/build.sh` now builds:
  - `agentdeck-d200h` (static musl fallback)
  - `agentdeck-d200h-dyn` (dynamic glibc + MI_GFX)
  - `fb-test`
- `--deploy` now pushes the dynamic agent to `/data/agentdeck-dyn`.
- D200H runtime path in the Node bridge was also moved to `/data/agentdeck-dyn`
  so the old static binary at `/data/agentdeck` cannot silently win again.
- Agent stdout/stderr are now unbuffered so the bridge can observe startup
  output immediately.
- The single-shot takeover shell no longer uses `sleep`, because `/bin/sh`
  on the device does not provide it.

### Swift daemon

- Swift `AdbModule` was previously still using:
  - multiple `adb shell` calls
  - `input text` for state push
  - no long-lived on-device agent process
- It is now aligned with the Node bridge model:
  - D200H is excluded from reverse setup/cleanup
  - a single foreground `adb shell` starts the on-device agent
  - daemon broadcasts are streamed to agent stdin
  - agent JSON button commands are routed back into daemon command handling
  - shell helper calls now have timeouts

## Remaining Risks

- The dynamic agent must actually be the binary present at
  `/data/agentdeck-dyn` on the device being tested.
- Swift daemon packaging does not yet bundle the D200H agent binary explicitly;
  current lookup supports app resources first and repo-relative paths second.
- Full 14-key matrix mapping is still unfinished.
- On-device logs remain critical. If the first shell session is lost, diagnosis
  quality drops sharply.
- `adb shell` on current boots can hang even for trivial commands like `ps`,
  so ad hoc probing is unreliable unless all needed capture is packed into the
  first shell session.

## Latest Findings

- Fresh-boot `fb-test --gfx --copy-test` reached:
  - `MI_SYS_Init: 0`
  - `MI_GFX_Open: 0`
  - `MI_GFX_QuickFill ... ret=0`
  - `MI_GFX_BitBlit ... ret=0`
- Despite API success, the screen still remained black.
- On the failing boot, `fb-test` reported `fb0 smem_start=0x30121000`.
- The previous known-good visible target was `0x50101000`, which matched
  `smem_start + 0x20000000` on an older boot (`0x30101000 -> 0x50101000`).
- A fallback alias guess using `smem_start + 0x20000000` was added to:
  - `zkswe/agent/src/framebuffer.c`
  - `zkswe/agent/src/fb_test.c`
- Even with that fallback, the current boot still produced a black screen.
- Current conclusion: `MI_GFX` is alive, but the visible target on this boot
  is likely not the guessed alias and must be recovered from the current
  `zkgui`/`zkdisplay` process maps.
- A single-shell maps dump on the current boot showed:
  - `/data/agentdeck --stdin` already running
  - its `/proc/*/maps` contained `/dev/fb0` mapped at `offset 0x50101000`
  - its `/proc/*/maps` also contained `/dev/mem` at `0x50101000`
  - but it did **not** contain `libmi_sys.so` or `libmi_gfx.so`
- This means the process currently driving the black screen is the static musl
  agent, not the intended dynamic MI_GFX binary.
- To prevent old static pushes from racing with the intended dynamic deploy,
  the Node bridge D200H runtime path was changed from `/data/agentdeck` to
  `/data/agentdeck-dyn`.
- A clean foreground daemon run later confirmed the active shell command was:
  - `exec /data/agentdeck-dyn --stdin`
- Even on that verified dynamic path, the user still observed a black screen.
- That rules out the old static-vs-dynamic path mismatch as the only remaining
  cause.
- To make startup diagnosis independent of fragile `adb shell` stdout capture,
  the on-device agent now writes boot diagnostics directly to:
  - `/data/agentdeck-boot.log`
- The boot log records:
  - framebuffer init and reported `smem_start`
  - `MI_GFX` / `/dev/mem` backend selection
  - early `fb_present()` path usage
  - stdin/ws loop startup and shutdown milestones
- A host-side conflict was found and removed:
  - `node /Users/puritysb/Library/pnpm/agentdeck opencode`
  - This process was still launching static `/data/agentdeck` pushes/shells and
    repeatedly polluted D200H tests even when the local repo daemon was stopped.
- A first-shell capture after reboot proved the device-side display stack is
  still healthy before takeover:
  - one stock process loaded `libmi_sys.so`, `libmi_disp.so`, `libmi_panel.so`
  - another stock process loaded `libnanovg.so` and `libmi_gfx.so`
- A first-shell takeover capture of the custom dynamic agent showed:
  - `AgentDeck D200H Agent v1.0`
  - `fb0 smem_start=0x30121000 line_length=2160`
  - `MI_GFX backend initialized (bus_base=0x50121000)`
  - `MI_GFX: active`
  - `Framebuffer OK (960x540)`
- Despite those logs, the panel was still black. This strongly suggests the
  derived target `0x50121000` is not visible even though `MI_GFX` initialization
  succeeds.
- Because the older known-good visible target remained `0x50101000`, both
  `framebuffer.c` and `fb_test.c` were changed again to prefer `0x50101000`
  for D200H instead of `smem_start + 0x20000000`.
- After that code change, the updated binary was rebuilt and pushed, but the
  final visual verification remained inconclusive because the ADB window kept
  collapsing back to stock firmware before a clean observe-and-log cycle could
  finish.

## New Tooling

- `zkswe/recon/d200h-maps-dump.sh`
  - Packs `ps`, framebuffer info, USB state, and `/proc/*/maps` for
    `zkgui`/`zkdisplay`/`zkdaemon` into a single adb shell session
  - Pulls the captured files afterward for local inspection
  - Intended specifically for boots where normal repeated `adb shell` probing
  quickly hangs

## Current Best Diagnosis

- There were two separate issues:
  - host-side stale launchers reintroducing static `/data/agentdeck`
  - device-side takeover rendering to the wrong visible target after reboot
- The first issue was materially reduced by:
  - moving runtime to `/data/agentdeck-dyn`
  - killing the global `agentdeck opencode` host process
- The second issue is still open.
- The strongest current hypothesis is:
  - takeover succeeds
  - dynamic agent and `MI_GFX` initialize successfully
  - but present goes to `0x50121000`, while the actual visible target remains
    `0x50101000`
- The next debugging agent should start from this hypothesis, not from
  “MI_GFX may be missing” or “the dynamic binary may not be running”.

## Next Verification Order

1. Build `zkswe/agent/build.sh`.
2. Confirm `agentdeck-d200h-dyn` exists locally.
3. Deploy to D200H so `/data/agentdeck-dyn` is the active binary.
4. Use `wait-for-device` and spend the first successful shell on exactly one of:
   - inline maps capture
   - immediate takeover execution
5. If doing takeover:
   - confirm startup logs include `AgentDeck D200H Agent v1.0`
   - confirm `MI_GFX: active`
   - record the reported `bus_base`
6. If the screen is still black and `bus_base` is not `0x50101000`, prefer
   forcing `0x50101000` again over introducing more alias heuristics.
7. Avoid mixing in any global or old host daemon while testing.
