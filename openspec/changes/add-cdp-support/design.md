## Context

rn-probe's `DevToolsBridge` currently connects only to port 8097, which is the legacy React DevTools WebSocket used by RN's old architecture (bridge mode). RN 0.73+ with new architecture (bridgeless) exposes Hermes via CDP through Metro's inspector proxy. When a user runs an app on new arch, port 8097 is either not open or not speaking the expected protocol — making all component inspection and eval commands fail silently or with a generic "not connected" error.

Metro's inspector proxy exposes:
- `GET http://localhost:8081/json` — lists available CDP targets (each Hermes runtime, React Native app instance)
- `ws://<webSocketDebuggerUrl>` — per-target CDP WebSocket; standard CDP domains apply (Runtime, Debugger, etc.)
- React DevTools CDP extensions are layered on top via `Page` domain messages specific to React Native

## Goals / Non-Goals

**Goals:**
- Auto-detect whether the connected app is new arch (CDP available) or legacy (port 8097)
- Implement CDP-based `eval`, `tree`, `inspect`, `find`, `network`, and `errors` that work on RN 0.73+ new arch
- Keep port 8097 as a working fallback for legacy/old arch projects
- Surface a clear, actionable error when neither path is available

**Non-Goals:**
- Full Chrome DevTools Protocol implementation — only the subset rn-probe needs
- Supporting physical device remote debugging over USB (adb forward handles the port, so the same code works)
- Replacing React DevTools UI — rn-probe is text output only

## Decisions

### D1: Auto-detect arch via `/json` probe, not a flag

**Decision**: At `rn open`, probe `GET /json`. If it returns a non-empty list of targets with a `webSocketDebuggerUrl`, activate CDP mode. If the request fails or returns empty, fall back to port 8097.

**Rationale**: Most users don't know or care which arch they're on. Auto-detection keeps the CLI ergonomics the same. The `--new-arch` flag is still accepted as an override for edge cases (e.g., `/json` is slow to appear on startup).

**Alternative considered**: Always require the flag. Rejected — adds friction and requires user knowledge of their project internals.

### D2: Separate `CDPBridge` class, not inline in `DevToolsBridge`

**Decision**: Implement CDP in a new `src/daemon/cdp.ts` class. `DevToolsBridge` holds a reference to either a `CDPBridge` or its own legacy WS client, and delegates all method calls.

**Rationale**: The two protocols are different enough that interleaving them in one class would be unreadable. The bridge abstraction keeps `daemon/index.ts` handler registrations unchanged — zero IPC protocol changes.

**Alternative considered**: Subclass `DevToolsBridge` for CDP. Rejected — TypeScript class inheritance here adds complexity without benefit; composition is cleaner.

### D3: React DevTools component tree via `ReactDevTools` CDP domain

**Decision**: Use the `ReactDevTools.getComponentTree` and `ReactDevTools.inspectElement` CDP commands that Hermes/Metro exposes when React DevTools are enabled. These are non-standard extensions to CDP specific to React Native.

**Rationale**: This is the same protocol the browser-based React Native DevTools (opened with `j` in Metro) uses internally. It returns the same structured component data as the old port 8097 protocol.

**Alternative considered**: Use `Runtime.evaluate` to call `__REACT_DEVTOOLS_GLOBAL_HOOK__` directly. Rejected — fragile, depends on internal React internals, and doesn't work when Hermes sandbox mode is on.

### D4: Error capture via `Runtime.exceptionThrown` CDP event

**Decision**: On new arch, subscribe to `Runtime.exceptionThrown` events over CDP to capture JS errors in real time, replacing the Metro `/status` polling approach.

**Rationale**: CDP events are push-based and immediate. Metro `/status` only reflects build errors, not runtime JS exceptions. `Runtime.exceptionThrown` gives us both.

**Alternative considered**: Keep polling `/status` and add a separate CDP error subscription. Rejected — redundant; CDP supersedes the polling approach entirely on new arch.

## Risks / Trade-offs

- **`ReactDevTools` CDP domain may not be available on all RN versions** → Fall back to `Runtime.evaluate(__REACT_DEVTOOLS_GLOBAL_HOOK__...)` if `ReactDevTools.getComponentTree` returns a method-not-found error; document the minimum RN version (0.73+)
- **Metro `/json` can be slow to populate targets after app launch** → Retry with backoff for up to 10s at `rn open`; print "Waiting for CDP targets..." to stdout so user knows what's happening
- **Multiple targets in `/json` (e.g., background JS, main app)** → Select the target whose `title` matches the app bundle name or is of `type: "react-native"`; if ambiguous, pick the first and log a warning
- **CDP WebSocket disconnects on app reload** → Re-probe `/json` after disconnect and reconnect to the new target (the webSocketDebuggerUrl changes after each reload)

## Open Questions

- Does `ReactDevTools.getComponentTree` exist in Hermes CDP on RN 0.73, or does it require a newer version? Need to verify against a live app.
- Is the `webSocketDebuggerUrl` in `/json` a full `ws://` URL or a relative path? Metro versions differ — need to normalise.
