## 1. CDP Bridge — Core

- [x] 1.1 Create `src/daemon/cdp.ts` with `CDPBridge` class skeleton: constructor, `connect()`, `disconnect()`, `isConnected()` getter
- [x] 1.2 Implement target discovery: `GET /json` with 10s retry loop (500ms interval); select `type: "react-native"` target or first; return `null` if Metro unreachable
- [x] 1.3 Implement CDP WebSocket connection to `webSocketDebuggerUrl`; send `Runtime.enable` and `Network.enable` on open
- [x] 1.4 Implement CDP request helper: send `{ id, method, params }`, await matching response by `id`, 10s timeout, throw on `error` in response
- [x] 1.5 Implement reconnect logic: on WebSocket close, re-probe `/json` and reconnect to new target URL

## 2. CDP Bridge — Features

- [x] 2.1 Implement `evaluate(script)`: send `Runtime.evaluate` with `returnByValue: true, awaitPromise: true`; throw on `exceptionDetails`
- [x] 2.2 Implement `getTree()`: send `ReactDevTools.getComponentTree`; format as indented `[id] DisplayName` text; throw with helpful message if domain unavailable
- [x] 2.3 Implement `inspect(id)`: send `ReactDevTools.inspectElement`; format props/state/hooks/source; return `null` if not found
- [x] 2.4 Implement `find(name)`: call `getTree()` internally, filter nodes by display name match
- [x] 2.5 Implement error buffer: subscribe to `Runtime.exceptionThrown` events; store up to 50 entries; expose `getErrors()` returning formatted text
- [x] 2.6 Implement network log: subscribe to `Network.requestWillBeSent` and `Network.responseReceived`; correlate by `requestId`; expose `getNetwork(idx?)` in same format as legacy

## 3. Protocol Auto-Detection

- [x] 3.1 Update `src/daemon/state.ts`: add `arch: "new" | "legacy" | "unknown"` field
- [x] 3.2 Update `open` handler in `src/daemon/index.ts`: probe `/json` first; if targets found activate `CDPBridge`, set `state.arch = "new"`; else activate legacy DevTools WS, set `state.arch = "legacy"`
- [x] 3.3 Add `--new-arch` flag to `rn open` in `src/cli.ts`: pass `forceNewArch: true` param; daemon skips probe and goes straight to CDP with 10s target wait

## 4. DevTools Bridge — Protocol Delegation

- [x] 4.1 Update `src/daemon/devtools.ts`: hold an optional `CDPBridge` reference; add `useCDP(bridge: CDPBridge)` method
- [x] 4.2 Update `getTree()`: delegate to `cdpBridge.getTree()` if connected, else legacy WS; clear error message if both unavailable
- [x] 4.3 Update `inspect(id)`: delegate to `cdpBridge.inspect(id)` if connected, else legacy WS
- [x] 4.4 Update `find(name)`: delegate to `cdpBridge.find(name)` if connected, else legacy WS
- [x] 4.5 Update `evaluate(script)`: delegate to `cdpBridge.evaluate(script)` if connected, else legacy WS
- [x] 4.6 Update `network(idx?)`: delegate to `cdpBridge.getNetwork(idx)` if connected, else legacy network log
- [x] 4.7 Update `getErrors()` (new method on DevToolsBridge): delegate to `cdpBridge.getErrors()` if connected, else legacy error cache

## 5. Metro Bridge — Error Integration

- [x] 5.1 Update `getErrors()` in `src/daemon/metro.ts`: accept optional `cdpErrors` string param; prepend CDP runtime errors before Metro build errors
- [x] 5.2 Update `errors` handler in `src/daemon/index.ts`: pass `devtools.getErrors()` result into `metro.getErrors()`

## 6. Build and Validation

- [x] 6.1 Run `pnpm build` — confirm zero TypeScript errors
- [x] 6.2 Manually test `rn open` against a new arch RN 0.73+ app — confirm `Connected via CDP` message and `rn tree` returns component tree
- [x] 6.3 Manually test `rn open` against a legacy/old arch project — confirm fallback to `Connected via DevTools (legacy)` and `rn tree` still works
- [x] 6.4 Commit, push to GitHub, bump version to `0.2.0`, publish to npm
