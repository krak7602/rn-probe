## Why

Claude Code can read files and run shell commands, but it has no programmatic window into a live React Native app — no component tree, no JS errors, no native logs, no way to drive the simulator. `rn-probe` fills that gap: a daemon + CLI tool that gives Claude Code structured, text-based introspection into a running RN app, applying the same pattern `@vercel/next-browser` uses for Next.js/browser to the React Native stack.

## What Changes

- Introduce a new standalone TypeScript package `@rn-probe/cli`
- Implement a long-lived daemon process that bridges Metro (port 8081), the RN DevTools WebSocket (port 8097), and simulator/device shell tools
- Implement stateless one-shot CLI commands that talk to the daemon over a Unix socket
- Support both bare React Native and Expo projects (Expo Go + dev builds)
- Provide a `SKILL.md` that bootstraps the tool inside Claude Code via `/rn-probe`
- Publish to npm; installable via `npx skills add rn-probe`

## Capabilities

### New Capabilities

- `daemon-ipc`: Long-lived daemon process with Unix socket IPC server; spawn/teardown lifecycle (`rn open`, `rn close`)
- `metro-bridge`: Metro bundler HTTP API client — bundle status, JS errors, Metro log streaming (`rn bundle-status`, `rn errors`, `rn logs`, `rn reload`, `rn restart-metro`)
- `devtools-bridge`: RN DevTools WebSocket client (port 8097) — component tree, element inspection, JS eval, network events, perf metrics (`rn tree`, `rn inspect`, `rn find`, `rn eval`, `rn network`, `rn logs perf`)
- `simulator-control`: xcrun simctl (iOS) + adb (Android) wrappers — screenshot, tap, swipe, viewport, deep-link navigation, native log streaming, back gesture, text input (`rn screenshot`, `rn tap`, `rn swipe`, `rn viewport`, `rn goto`, `rn back`, `rn logs native`, `rn type`)
- `cli-interface`: Commander.js CLI entry point and command routing; all commands are stateless one-shots that communicate with the daemon via IPC
- `skill-md`: `SKILL.md` with bootstrap flow, command cheat sheet, escalation guidance, and RN/Expo-specific gotchas; published as an `npx skills add` installable skill

### Modified Capabilities

## Impact

- New package: no existing code is modified
- Dependencies: `ws`, `commander`, `execa`, `node-fetch` (or native `http`), `pnpm`
- Runtime dependencies: `xcrun simctl` (macOS), `adb` (optional, Android), Metro running on port 8081, RN DevTools on port 8097
- Consumed by Claude Code via SKILL.md — no direct user-facing API beyond the CLI
