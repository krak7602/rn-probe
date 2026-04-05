## Context

`rn-probe` is a new standalone TypeScript package. There is no existing codebase to migrate — this is a greenfield build. The design is directly modelled on `@vercel/next-browser`: a long-lived daemon holds all stateful connections, and stateless one-shot CLI commands talk to it over a Unix socket.

The daemon bridges three external surfaces:
1. **Metro** (HTTP, port 8081) — bundle status, errors, log streaming, reload
2. **React Native DevTools WebSocket** (port 8097) — component tree, element inspection, JS eval, network, perf
3. **Simulator/device shell** (`xcrun simctl`, `adb`) — screenshot, tap, swipe, navigation, native logs

Claude Code invokes the CLI commands and reads their stdout. All session state lives in the daemon.

## Goals / Non-Goals

**Goals:**
- Provide Claude Code with structured text output for every observable surface of a live RN app
- Support both iOS simulator (xcrun simctl) and Android emulator/device (adb)
- Support bare React Native, Expo dev builds, and Expo Go
- Be installable in one command via `npx skills add rn-probe`
- Mirror next-browser's daemon + stateless CLI + SKILL.md architecture exactly

**Non-Goals:**
- GUI or browser-based UI
- Physical device USB support beyond adb (which already handles it)
- Production app instrumentation (dev only)
- Supporting React Native < 0.71 or Hermes-off configurations as primary targets
- Any CI/CD integration — this is an interactive pair-programming tool

## Decisions

### D1: Unix socket for IPC (not HTTP, not stdin/stdout pipe)

**Decision**: Daemon listens on a Unix domain socket at a well-known path (e.g., `/tmp/rn-probe-<pid-or-hash>.sock` or a fixed path like `/tmp/rn-probe.sock`).

**Rationale**: This is the pattern next-browser uses. Unix sockets are low-latency, need no port allocation, and are trivially cleaned up on teardown. Named pipes are more awkward to multiplex. HTTP would add unnecessary overhead and port conflicts.

**Alternative considered**: HTTP on a fixed loopback port (e.g., 57321). Rejected because it risks collision with other tools and is slower to set up.

### D2: Daemon auto-spawned on first CLI command

**Decision**: If no daemon is running when a CLI command fires, the CLI spawns the daemon as a detached background process and waits for the socket to appear (with a short timeout), then proceeds.

**Rationale**: Users should not have to manually manage daemon lifecycle except via `rn open` / `rn close`. The auto-spawn pattern means `rn bundle-status` just works even if the user forgot to run `rn open`.

**Alternative considered**: Require explicit `rn open` before any other command. Rejected as too friction-heavy for a pair-programming tool.

### D3: React DevTools bridge via `react-devtools-core` protocol (not CDP)

**Decision**: Connect to port 8097 using the React DevTools backend protocol (same protocol `react-devtools` uses). Reference `react-devtools-core` for message type definitions.

**Rationale**: Port 8097 speaks the React DevTools protocol, not Chrome DevTools Protocol. `rn inspect`, `rn tree`, and `rn eval` all use this channel. The Hermes CDP endpoint (port 8081/cdp or the debugger port) is separate and used only as a fallback for `rn eval` if the DevTools socket doesn't support `evaluateOnCallFrame`.

**Alternative considered**: Use Metro's `/debugger-proxy` endpoint or the Hermes CDP directly for everything. Rejected because the DevTools WebSocket gives richer component tree data.

### D4: Structured text output (not JSON) as default

**Decision**: CLI commands print human-readable structured text by default. An optional `--json` flag can be added later, but it is not the primary output format.

**Rationale**: Claude Code reads stdout and parses it. Structured text (indented trees, labeled key-value pairs) is readable both by Claude and by humans inspecting tool output. JSON is noisier for Claude to reason about inline.

**Alternative considered**: Always output JSON. Rejected — plain structured text is easier for Claude to pattern-match without extra parsing prompts.

### D5: Expo support via flags at `rn open`, not auto-detection

**Decision**: User passes `--expo-go` or `--dev-build` to `rn open`. The daemon stores this mode and uses it for all subsequent deep-link commands. Default (no flag) = bare RN.

**Rationale**: Auto-detecting Expo vs bare RN is unreliable (both can coexist, dev builds look like bare RN from the outside). The SKILL.md bootstrap asks the user at startup, so the flag is always known.

**Alternative considered**: Auto-detect by checking for `expo` in package.json. Rejected — dev builds are indistinguishable from bare RN at runtime.

### D6: iOS first, Android second

**Decision**: Phase 3 implements iOS (`xcrun simctl`) first, then Android (`adb`). The daemon abstraction (`simulator.ts`) wraps both behind a common interface.

**Rationale**: The primary dev machine is macOS; iOS simulator is the most common RN dev target. The `adb` surface is nearly identical to `xcrun simctl` for our purposes so adding Android is low-effort after iOS works.

## Risks / Trade-offs

- **RN DevTools protocol is undocumented and can change between RN versions** → Pin to a known-good RN version in CI; document the protocol messages we rely on; add a version check at `rn open`
- **Port 8097 may not be open if DevTools aren't attached** → Daemon retries connection with backoff; CLI commands that need port 8097 emit a clear error if unavailable
- **xcrun simctl requires a booted simulator** → `rn open` checks simulator state and boots one if needed; surface the simulator UDID in `rn open` output so the user can verify
- **Metro stdout pipe is only available if we spawned Metro** → For externally-launched Metro, `rn logs` falls back to polling `GET /status` and scraping build output; native Metro logs are available via `xcrun simctl spawn booted log stream`
- **Unix socket cleanup on crash** → Daemon registers SIGTERM/SIGINT handlers and `process.on('exit')` to unlink the socket; CLI includes a `rn open --force` that removes a stale socket and respawns

## Open Questions

- Should `rn eval` use the DevTools WebSocket `evaluateOnCallFrame` or the Hermes CDP debugger endpoint? Need to validate which is available without attaching a debugger.
- What is the exact socket protocol for `react-devtools-core` bridge initialization? Need to trace the `react-devtools` source to confirm the handshake sequence.
- Should we support multiple simultaneous simulators (e.g., iPhone + iPad)? Current design assumes one active target — flag with `--udid` to override.
