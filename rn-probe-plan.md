# rn-probe — Development Plan

> Named `rn-probe` rather than `rn-browser` because unlike next-browser, there is no browser in the stack. The name reflects what the tool actually does — probing a live React Native runtime.

## Ideology & Inspiration

This project is a direct spiritual fork of [`@vercel/next-browser`](https://github.com/vercel-labs/next-browser).

next-browser's core insight: **an LLM can't read a DevTools panel, but it can run a shell command and parse structured text.** It solves this for Next.js by sitting between Claude Code and the browser — a long-lived daemon that maintains the browser/DevTools connection, with stateless one-shot CLI commands fired against it.

`rn-probe` applies the exact same pattern to React Native:
- Same daemon + CLI split
- Same SKILL.md-based discovery (via `npx skills add`)
- Same "agent drives the tool" philosophy — Claude Code runs commands, reads output, decides what to inspect next
- Same stateless command design — no session state in the CLI, all state lives in the daemon

The difference is the surface: instead of a Chromium page and React DevTools over Chrome DevTools Protocol, we bridge **Metro bundler**, **React Native's DevTools WebSocket** (port 8097), and **simulator/device shell tools** (`xcrun simctl`, `adb`).

rn-probe works with both **bare React Native** and **Expo** projects. Metro, the RN DevTools WebSocket, and the simulator layer are identical in both — Expo doesn't change any of these. The only surface where Expo differs is deep-link handling in `rn probe goto`, which uses `exp://` in Expo Go vs your own app scheme in dev builds and bare workflow. Since Expo projects don't always use Expo Go (dev builds are common), rn-probe asks the user to clarify at startup rather than assuming.

Where next-browser stops at the browser boundary, rn-probe goes one layer deeper — into native UI via Claude Code's **computer use** capability, used as a last resort when no programmatic path exists.

> **When building this, reference next-browser's source for structural patterns:**
> - How the daemon is spawned and kept alive across CLI invocations
> - How the SKILL.md skill bootstraps itself (install check → connect → pair programming mode)
> - How commands are structured as stateless one-shots
> - The `open/close` lifecycle pattern

---

## Architecture

```
rn-probe/
  src/
    daemon/           # Long-lived process: bridges Metro + RN DevTools WS + simulator
      index.ts        # Daemon entry, IPC socket server
      metro.ts        # Metro bundler HTTP API client (port 8081)
      devtools.ts     # React Native DevTools WebSocket client (port 8097)
      simulator.ts    # xcrun simctl + adb shell wrappers
    commands/         # One-shot CLI commands, each talks to daemon via IPC
      open.ts
      close.ts
      tree.ts
      inspect.ts
      errors.ts
      logs.ts
      reload.ts
      screenshot.ts
      tap.ts
      viewport.ts
      network.ts
      eval.ts
      perf.ts
    cli.ts            # CLI entry point (commander/yargs)
    ipc.ts            # Shared IPC client/server helpers
  SKILL.md            # Claude Code skill — invoked via /rn-probe
  package.json
  tsconfig.json
  README.md
```

---

## Command Reference

Each command below lists: what it does, its data source, and the next-browser equivalent it mirrors.

### Lifecycle

| Command | Description | Data Source | next-browser equivalent |
|---|---|---|---|
| `rn open [metroUrl]` | Connect daemon to Metro + RN DevTools, optionally boot simulator. Accepts `--expo-go` flag (sets deep-link scheme to `exp://`) or `--dev-build` flag (uses custom app scheme). Defaults to bare RN behaviour if neither flag is passed. | Metro ping + `xcrun simctl boot` / `adb start-server` | `next-browser open <url>` |
| `rn close` | Tear down daemon, disconnect all bridges | daemon IPC | `next-browser close` |
| `rn restart-metro` | Kill and restart Metro bundler, clears JS cache | `xcrun simctl spawn` or `adb shell` signal + Metro restart | `next-browser restart-server` |

### Navigation & State

| Command | Description | Data Source | next-browser equivalent |
|---|---|---|---|
| `rn goto <screen>` | Deep-link navigate to a screen. Uses `exp://` scheme in Expo Go mode, custom app scheme otherwise. Scheme is inferred from the flag passed to `rn open`, or can be overridden with `--scheme <scheme>`. | `xcrun simctl openurl` / `adb shell am start` with deep link URI | `next-browser goto <url>` |
| `rn back` | Trigger hardware back / navigation pop | `xcrun simctl` key event / `adb shell input keyevent BACK` | `next-browser back` |
| `rn reload` | Trigger JS bundle reload (hot reload) | Metro WebSocket reload signal | `next-browser reload` |

### Component Inspection

| Command | Description | Data Source | next-browser equivalent |
|---|---|---|---|
| `rn tree` | Print full React component tree as structured text | RN DevTools WebSocket (port 8097) — `getComponentTree` message | `next-browser tree` |
| `rn inspect <id>` | Inspect a single component: props, state, hooks, source file + line | RN DevTools WebSocket — `inspectElement` message | `next-browser tree <id>` |
| `rn find <name>` | Search component tree by display name, returns matching node IDs | RN DevTools WebSocket — tree traversal | _(next-browser has no direct equivalent)_ |

### Errors & Logs

| Command | Description | Data Source | next-browser equivalent |
|---|---|---|---|
| `rn errors` | Show JS errors, RN RedBox content, and Metro build errors | RN DevTools error events + Metro `/status` JSON endpoint | `next-browser errors` |
| `rn logs` | Stream recent Metro dev server output | Metro stdout pipe via daemon | `next-browser logs` |
| `rn logs native` | Stream native device logs filtered to your app bundle ID | `xcrun simctl spawn booted log stream --predicate` / `adb logcat` | _(no equivalent — web has no native layer)_ |
| `rn logs perf` | Show JS thread, UI thread, and render performance metrics | RN DevTools performance events | _(no equivalent)_ |

### Visual & Interaction

| Command | Description | Data Source | next-browser equivalent |
|---|---|---|---|
| `rn screenshot` | Save full simulator screenshot to tmp file, print path | `xcrun simctl io booted screenshot` / `adb exec-out screencap` | `next-browser screenshot` |
| `rn tap <x> <y>` | Send a tap event at coordinates | `xcrun simctl io booted sendEvent` / `adb shell input tap` | _(next-browser uses browser click — this is the RN equivalent)_ |
| `rn swipe <x1,y1> <x2,y2>` | Send a swipe gesture | `xcrun simctl io booted sendEvent` / `adb shell input swipe` | _(no equivalent)_ |
| `rn viewport [WxH]` | Show or set simulator window/screen size | `xcrun simctl` device config / `adb shell wm size` | `next-browser viewport [WxH]` |
| `rn type <text>` | Type text into currently focused input | `xcrun simctl io booted sendEvent` keyboard / `adb shell input text` | _(no equivalent)_ |

### Network

| Command | Description | Data Source | next-browser equivalent |
|---|---|---|---|
| `rn network [idx]` | List intercepted network requests, or inspect one by index | RN DevTools network events (requires Hermes network inspection enabled) | `next-browser network [idx]` |

### Bundle & Build

| Command | Description | Data Source | next-browser equivalent |
|---|---|---|---|
| `rn bundle-status` | Show Metro bundle status: modules loaded, warnings, build time | Metro HTTP API `GET /status` + `GET /symbolicate` | _(analogous to next-browser build error reporting)_ |
| `rn eval <script>` | Evaluate JS in the RN runtime context | RN DevTools `evaluateOnCallFrame` / Hermes CDP | `next-browser eval <script>` |

### Computer Use Escalation

These are cases where no programmatic path exists. The SKILL.md instructs Claude Code to use these only after exhausting the above commands.

| Command | Description | When to use |
|---|---|---|
| `rn use-computer` | Signals Claude Code to activate computer use for the current task | Visual layout bugs, onboarding flows, GUI-only native controls, animation validation |

Claude Code's tool hierarchy for this skill:
1. Try a structured `rn` command first
2. Fall back to `rn screenshot` + `rn tap` for interaction
3. Only escalate to computer use when vision + clicks are needed (e.g. "does the animation look right")

---

## SKILL.md Design

The skill follows the same bootstrap pattern as next-browser:

```
/rn-probe invoked
  → check for @rn-probe/cli globally
  → install if missing (+ install xcrun / adb check)
  → ask: Metro URL? (default: http://localhost:8081)
  → ask: target? (iOS simulator / Android emulator / device)
  → ask: project type? (bare RN / Expo dev build / Expo Go)
  → rn open <metroUrl> [--expo-go | --dev-build]
  → pair programming mode
```

The skill file also includes:
- Command cheat sheet (so Claude Code doesn't have to guess syntax)
- Guidance on when to escalate to computer use
- How to read component IDs from `rn tree` output for use in `rn inspect`
- RN-specific gotchas (Hermes vs JSC, Expo vs bare workflow, bridge vs bridgeless)
- Expo-specific notes: Expo Go uses `exp://` deep links, dev builds use the custom app scheme, both use the same Metro and DevTools ports — user clarifies mode at startup via `--expo-go` or `--dev-build`

---

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript | Same as next-browser |
| CLI framework | Commander.js | Same as next-browser |
| DevTools bridge | `ws` WebSocket client | RN DevTools uses the same React DevTools protocol — reference the `react-devtools-core` package for message types |
| Metro client | `node-fetch` / native `http` | Metro exposes a plain HTTP JSON API |
| IPC (daemon ↔ CLI) | Unix socket | Same pattern next-browser uses for its daemon |
| Simulator control | `execa` wrapping `xcrun simctl` and `adb` | Shell out, parse stdout |
| Package manager | pnpm | Same as next-browser |

---

## Development Phases

### Phase 1 — Daemon + Metro bridge
- Daemon process with Unix socket IPC
- `rn open` / `rn close` lifecycle
- `rn bundle-status`, `rn errors`, `rn logs`
- Get Claude Code reading Metro errors as structured text

### Phase 2 — React DevTools bridge
- Connect to RN DevTools WebSocket (port 8097)
- `rn tree`, `rn inspect <id>`, `rn find <name>`
- `rn eval`

### Phase 3 — Simulator/device control
- `rn screenshot`, `rn tap`, `rn swipe`, `rn viewport`
- `rn goto` via deep links
- `rn logs native`
- iOS (xcrun simctl) first, Android (adb) second

### Phase 4 — SKILL.md + packaging
- Write the skill file with bootstrap flow
- Publish to npm as `@rn-probe/cli`
- Test `npx skills add` flow end to end with Claude Code

### Phase 5 — Computer use integration
- Add `rn use-computer` hint command
- Update SKILL.md with escalation guidance
- Test visual validation workflows in Claude Code

---

## Key References

- **next-browser source**: https://github.com/vercel-labs/next-browser — read `src/` for daemon/CLI patterns and `SKILL.md` for skill structure
- **React DevTools protocol**: `react-devtools-core` package — the same protocol RN uses on port 8097
- **Metro HTTP API**: `GET /status`, `GET /assets`, `GET /symbolicate` — documented in the Metro source
- **xcrun simctl**: `xcrun simctl help` — all simulator control lives here on macOS
- **Claude Code computer use**: https://code.claude.com/docs — for the escalation path
- **skills.sh**: https://skills.sh — for the `npx skills add` packaging convention
