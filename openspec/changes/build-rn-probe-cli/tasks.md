## 1. Project Scaffold

- [x] 1.1 Initialize pnpm workspace with `package.json` (name: `@rn-probe/cli`, bin: `rn`)
- [x] 1.2 Configure `tsconfig.json` (target: ES2022, module: NodeNext, strict: true)
- [x] 1.3 Add dependencies: `commander`, `ws`, `execa`, `uuid`; devDependencies: `typescript`, `@types/ws`, `@types/node`
- [x] 1.4 Create `src/` directory structure: `daemon/`, `commands/`, `cli.ts`, `ipc.ts`

## 2. IPC Layer

- [x] 2.1 Implement `src/ipc.ts` — shared newline-delimited JSON protocol types (`Request`, `Response`, `ErrorResponse`)
- [x] 2.2 Implement IPC client helper: connect to `/tmp/rn-probe.sock`, send request, await response with timeout
- [x] 2.3 Implement stale socket detection: if connect fails with ECONNREFUSED, delete socket and return `null`

## 3. Daemon Core

- [x] 3.1 Implement `src/daemon/index.ts` — Unix socket server that dispatches incoming IPC requests to registered handlers
- [x] 3.2 Implement daemon state store: active Metro URL, Expo mode, target UDID, bridge connection statuses
- [x] 3.3 Register SIGTERM/SIGINT/`process.on('exit')` handlers to unlink socket on shutdown
- [x] 3.4 Implement daemon spawn logic in CLI: detect missing socket → spawn daemon as detached process → poll for socket (5s timeout)

## 4. Metro Bridge (Phase 1)

- [x] 4.1 Implement `src/daemon/metro.ts` — HTTP client for Metro `GET /status` endpoint
- [x] 4.2 Implement `bundle-status` IPC handler: parse Metro status response, format as structured text
- [x] 4.3 Implement `errors` IPC handler: query Metro for JS errors and build errors, format with stack traces
- [x] 4.4 Implement Metro stdout capture: pipe Metro process stdout to daemon log buffer (ring buffer, last 500 lines)
- [x] 4.5 Implement `logs` IPC handler: return buffered Metro log lines; support `--lines` param
- [x] 4.6 Implement `reload` IPC handler: send reload signal to Metro via WebSocket or HTTP
- [x] 4.7 Implement `restart-metro` IPC handler: kill Metro process, restart with `--reset-cache`, wait for ready

## 5. CLI Entry Point and Phase 1 Commands

- [x] 5.1 Implement `src/cli.ts` — Commander.js program with global `--target` and `--json` flags
- [x] 5.2 Implement `rn open` command: accept Metro URL arg, `--expo-go`, `--dev-build`, `--force` flags; send `open` IPC request
- [x] 5.3 Implement `rn close` command: send `close` IPC request; handle daemon not running gracefully
- [x] 5.4 Implement `rn bundle-status` command: send IPC, print result
- [x] 5.5 Implement `rn errors` command: send IPC, print result
- [x] 5.6 Implement `rn logs` command: send IPC with `--lines` flag, print result
- [x] 5.7 Implement `rn reload` command: send IPC, print `Reload triggered.`
- [x] 5.8 Implement `rn restart-metro` command: send IPC, print `Metro restarted.`
- [x] 5.9 Add build script (`tsc`) and `bin` field in `package.json` pointing to compiled `cli.js`

## 6. React DevTools Bridge (Phase 2)

- [x] 6.1 Research the `react-devtools-core` WebSocket handshake sequence (trace source or reference next-browser)
- [x] 6.2 Implement `src/daemon/devtools.ts` — WebSocket client connecting to port 8097 with handshake and reconnect logic
- [x] 6.3 Implement `tree` IPC handler: send `getComponentTree` message, parse response, format as indented `[id] DisplayName` text
- [x] 6.4 Implement `inspect` IPC handler: send `inspectElement` message for given ID, format props/state/hooks/source
- [x] 6.5 Implement `find` IPC handler: traverse component tree response, filter by display name, return matching IDs
- [x] 6.6 Implement `eval` IPC handler: send `evaluateOnCallFrame` (or Hermes CDP fallback), return serialized result
- [x] 6.7 Implement `network` IPC handler: collect DevTools network events, return list or single request by index; detect if Hermes network inspection is disabled
- [x] 6.8 Implement `logs perf` IPC handler: collect DevTools performance events, report JS/UI thread FPS
- [x] 6.9 Wire up CLI commands: `rn tree`, `rn inspect <id>`, `rn find <name>`, `rn eval <script>`, `rn network [idx]`, `rn logs perf`

## 7. Simulator Control (Phase 3 — iOS first)

- [x] 7.1 Implement `src/daemon/simulator.ts` — abstraction with iOS (`xcrun simctl`) and Android (`adb`) backends; auto-detect active platform
- [x] 7.2 Implement iOS `screenshot` handler: run `xcrun simctl io booted screenshot <tmppath>`, return file path
- [x] 7.3 Implement iOS `tap` handler: `xcrun simctl io booted sendEvent` with tap event at (x, y)
- [x] 7.4 Implement iOS `swipe` handler: `xcrun simctl io booted sendEvent` with swipe event
- [x] 7.5 Implement iOS `viewport` handler: parse `xcrun simctl list devices` for screen size; no resize on iOS
- [x] 7.6 Implement iOS `goto` handler: `xcrun simctl openurl booted <url>`; apply Expo mode scheme logic
- [x] 7.7 Implement iOS `back` handler: send hardware back via simulator key event
- [x] 7.8 Implement iOS `logs native` handler: spawn `xcrun simctl spawn booted log stream --predicate` filtered to bundle ID; stream stdout
- [x] 7.9 Implement iOS `type` handler: send keyboard events via `xcrun simctl io booted sendEvent`
- [x] 7.10 Implement Android backend for all above commands using `adb shell input`, `adb exec-out screencap`, `adb shell am start`, `adb logcat`
- [x] 7.11 Wire up CLI commands: `rn screenshot`, `rn tap <x> <y>`, `rn swipe <x1,y1> <x2,y2>`, `rn viewport [WxH]`, `rn goto <screen>`, `rn back`, `rn logs native`, `rn type <text>`
- [x] 7.12 Implement `rn use-computer` command: print escalation message instructing Claude Code to activate computer use

## 8. SKILL.md and Packaging (Phase 4)

- [x] 8.1 Write `SKILL.md` with bootstrap flow (install check → Metro URL → target platform → project type → `rn open`)
- [x] 8.2 Add complete command cheat sheet to SKILL.md covering all `rn` subcommands with args and flags
- [x] 8.3 Add tool escalation guidance section to SKILL.md (structured commands → screenshot+tap → computer use)
- [x] 8.4 Add RN/Expo gotchas section to SKILL.md (Hermes vs JSC, Expo Go vs dev build, bridge vs bridgeless)
- [x] 8.5 Configure `package.json` for npm publish: `files`, `main`, `bin`, `keywords`, `description`
- [x] 8.6 Add `skills.sh` metadata to package for `npx skills add rn-probe` compatibility
- [x] 8.7 Write `README.md` with install instructions, quick start, and command reference
- [ ] 8.8 Publish `@rn-probe/cli` to npm; verify `npx skills add rn-probe` installs SKILL.md correctly

## 9. Computer Use Integration (Phase 5)

- [x] 9.1 Finalize `rn use-computer` output format: structured message with context explaining why escalation is needed
- [x] 9.2 Update SKILL.md escalation section with concrete examples (animation validation, GUI-only native controls, onboarding flows)
- [ ] 9.3 Test full escalation workflow in Claude Code: `rn screenshot` → `rn tap` → `rn use-computer`
