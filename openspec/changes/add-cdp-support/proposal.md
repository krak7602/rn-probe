## Why

RN 0.73+ with the new architecture exposes debugging via Chrome DevTools Protocol (CDP) through Metro, replacing the legacy DevTools WebSocket on port 8097. This means `rn tree`, `rn inspect`, `rn find`, `rn eval`, `rn network`, and `rn errors` are all broken for new arch projects — the majority of actively maintained RN apps. rn-probe needs to support CDP as the primary path while keeping port 8097 as a fallback for legacy projects.

## What Changes

- **New**: `CDPBridge` — discovers targets via `GET http://localhost:8081/json`, connects to the Hermes CDP WebSocket, and implements `Runtime.evaluate`, `Runtime.getProperties`, and React DevTools CDP extensions for component inspection
- **Modified**: `devtools-bridge` — try CDP first (new arch), fall back to port 8097 (legacy); surface clear errors distinguishing "not connected" from "unsupported protocol"
- **Modified**: `metro-bridge` — use CDP `Runtime.exceptionThrown` events for JS error capture instead of polling `/status` (more reliable on new arch)
- **Modified**: `cli-interface` — `rn open` gains a `--new-arch` flag to force CDP mode; auto-detection based on `GET /json` response is the default

## Capabilities

### New Capabilities

- `cdp-bridge`: CDP client that discovers Hermes targets via Metro's `/json` endpoint, connects to the debugger WebSocket, and exposes `evaluate`, `getComponentTree`, `inspectElement`, and network/error event subscriptions via the React DevTools CDP extensions

### Modified Capabilities

- `devtools-bridge`: Protocol selection logic changes — auto-detect new arch (CDP) vs legacy (port 8097); fallback behaviour and error messaging requirements change
- `metro-bridge`: Error capture now uses CDP `Runtime.exceptionThrown` events as the primary source on new arch builds

## Impact

- `src/daemon/devtools.ts` — major update: wrap existing logic as "legacy" path, add CDP path
- `src/daemon/metro.ts` — minor update: subscribe to CDP error events when in new arch mode
- `src/daemon/index.ts` — no handler changes; bridge selection is internal to the bridges
- `src/cli.ts` — add `--new-arch` flag to `rn open`
- New file: `src/daemon/cdp.ts`
- No breaking changes to CLI interface or IPC protocol
