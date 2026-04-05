# D200H Handoff Prompt

You are taking over D200H debugging in the AgentDeck repo.

Read these first:
- `CLAUDE.md`
- `DEVELOPMENT_LOG.md`
- `zkswe/D200H_STATUS.md`

## Goal

Make ULANZI D200H reliably boot into the custom AgentDeck takeover path instead
of falling back to the stock firmware, and make the display show AgentDeck
instead of a black screen.

## Current State

- The old static-vs-dynamic runtime confusion has mostly been cleaned up.
- D200H custom runtime should now use:
  - `/data/agentdeck-dyn`
- Node bridge D200H runtime path is:
  - `bridge/src/adb-reverse.ts`
- Swift daemon path was also updated to:
  - `/data/agentdeck-dyn`
- The global host-side conflict process that kept reintroducing static
  `/data/agentdeck` was:
  - `node /Users/puritysb/Library/pnpm/agentdeck opencode`
- That process was manually killed during debugging because it kept spawning
  stale `adb push ... agentdeck-d200h /data/agentdeck` and stale
  `adb shell ... exec /data/agentdeck --stdin`.

## What Is Confirmed

- `MI_GFX` is present on the device.
- Stock display processes load the expected libraries:
  - `libmi_sys.so`
  - `libmi_disp.so`
  - `libmi_panel.so`
  - `libmi_gfx.so`
  - `libnanovg.so`
- The custom dynamic agent can start successfully on device.
- First-shell custom startup logs captured this:
  - `AgentDeck D200H Agent v1.0`
  - `fb0 smem_start=0x30121000 line_length=2160`
  - `MI_GFX backend initialized (bus_base=0x50121000)`
  - `MI_GFX: active`
  - `Framebuffer OK (960x540)`
- Despite that, the screen was still black.

## Strongest Current Hypothesis

- The failure is no longer “dynamic binary missing” or “MI_GFX missing”.
- The strongest remaining hypothesis is:
  - takeover succeeds
  - dynamic agent starts
  - `MI_GFX` initializes
  - but rendering goes to the wrong visible target
- Historical known-good visible target:
  - `0x50101000`
- The failing first-shell startup used:
  - `0x50121000`
- So the most likely issue is visible target drift / wrong bus alias selection.

## Recent Code Changes Already Applied

- `zkswe/agent/src/main.c`
  - boot log written to `/data/agentdeck-boot.log`
  - stdout/stderr switched to unbuffered mode
- `zkswe/agent/src/framebuffer.c`
  - boot logging added
  - D200H bus alias logic now prefers `0x50101000`
- `zkswe/agent/src/fb_test.c`
  - same preferred target logic for test binary
- `bridge/src/adb-reverse.ts`
  - D200H runtime path uses `/data/agentdeck-dyn`
  - `sleep 1` removed from takeover shell because device `/bin/sh` does not
    provide `sleep`
- `apple/AgentDeck/Daemon/Modules/AdbModule.swift`
  - D200H path updated to `/data/agentdeck-dyn`

## Practical Constraints

- D200H `adbd` is highly unstable.
- Often only the first successful shell after reboot is useful.
- Repeated `adb shell`, `adb pull`, or `adb exec-out` calls often hang.
- ADB visibility window is short; sometimes `adb devices` shows the device,
  but a later shell already misses it.
- If the device falls back to the stock firmware, ADB often disappears.

## Best Known Tactics

- Prefer `adb -s 0123456789ABCDEF wait-for-device ...` patterns.
- Spend the first successful shell on exactly one purpose:
  - inline maps capture
  - or immediate takeover execution
- Avoid “check first, then run” two-step flows when possible. The device often
  disappears between those two steps.
- Do not let any global host daemon or stale ADB job run in parallel.

## Good Evidence Commands

Inline first-shell liveness probe:

```sh
adb -s 0123456789ABCDEF wait-for-device shell 'echo __D200H_OK__'
```

Inline first-shell takeover:

```sh
adb -s 0123456789ABCDEF wait-for-device shell "
chmod 444 /sys/class/zkswe_usb/zkswe0/functions /sys/class/zkswe_usb/zkswe0/enable;
mount -o bind /dev/null /bin/zkgui 2>/dev/null;
mount -o bind /dev/null /bin/zkdisplay 2>/dev/null;
for P in \$(ps | busybox awk '/zkgui_ui|\/bin\/zkgui|\/bin\/zkdisplay|\/bin\/zkdaemon/{print \$1}'); do kill \$P 2>/dev/null; done;
for P in \$(ps | busybox awk '/agentdeck/{print \$1}'); do kill \$P 2>/dev/null; done;
chmod +x /data/agentdeck-dyn 2>/dev/null;
exec /data/agentdeck-dyn --stdin"
```

## What To Do Next

1. Assume the next bug is in visible target selection, not in library loading.
2. Verify the newly rebuilt `agentdeck-d200h-dyn` really includes the forced
   `0x50101000` preference.
3. Use first-shell takeover again and capture startup output.
4. If startup still reports `bus_base=0x50121000`, the new binary was not the
   one actually executed.
5. If startup reports `bus_base=0x50101000` and the screen is still black,
   inspect whether page0/page1 assumptions regressed.
6. If needed, create a tiny first-shell test path that does only:
   - `MI_GFX_QuickFill(0x50101000)`
   - no full agent startup
   - no stdin loop
7. Keep all logging/capture inline in the first shell whenever possible.

## Success Criteria

- Reboot D200H
- First shell takes over before stock firmware fully wins
- AgentDeck remains on screen
- No fallback to stock UI
- No black screen
