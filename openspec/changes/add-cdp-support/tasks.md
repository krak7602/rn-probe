## 1. CDP Bridge — Core

- [ ] 1.1 Create `src/daemon/cdp.ts` with `CDPBridge` class skeleton: constructor, `connect()`, `disconnect()`, `isConnected()` getter
- [ ] 1.2 Implement target discovery: `GET /json` with 10s retry loop (500ms interval); select `type: "react-native"` target or first; return `null` if Metro unreachable
- [ ] 1.3 Implement CDP WebSocket connection to `webSocketDebuggerUrl`; send `Runtime.enable` and `Network.enable` on open
- [ ] 1.4 Implement CDP request helper: send `{ id, method, params }`, await matching response by `id`, 10s timeout, throw on `error` in response
- [ ] 1.5 Implement reconnect logic: on WebSocket close, re-probe `/json` and reconnect to new target URL

## 2. CDP Bridge — Features

- [ ] 2.1 Implement `evaluate(script)`: send `Runtime.evaluate` with `returnByValue: true, awaitPromise: true`; throw on `exceptionDetails`
- [ ] 2.2 Implement `getTree()`: send `ReactDevTools.getComponentTree`; format as indented `[id] DisplayName` text; throw with helpful message if domain unavailable
- [ ] 2.3 Implement `inspect(id)`: send `ReactDevTools.inspectElement`; format props/state/hooks/source; return `null` if not found
- [ ] 2.4 Implement `find(name)`: call `getTree()` internally, filter nodes by display name match
- [ ] 2.5 Implement error buffer: subscribe to `Runtime.exceptionThrown` events; store up to 50 entries; expose `getErrors()` returning formatted text
- [ ] 2.6 Implement network log: subscribe to `Network.requestWillBeSent` and `Network.responseReceived`; correlate by `requestId`; expose `getNetwork(idx?)` in same format as legacy

## 3. Protocol Auto-Detection

- [ ] 3.1 Update `src/daemon/state.ts`: add `arch: "new" | "legacy" | "unknown"` field
- [ ] 3.2 Update `open` handler in `src/daemon/index.ts`: probe `/json` first; if targets found activate `CDPBridge`, set `state.arch = "new"`; else activate legacy DevTools WS, set `state.arch = "legacy"`
- [ ] 3.3 Add `--new-arch` flag to `rn open` in `src/cli.ts`: pass `forceNewArch: true` param; daemon skips probe and goes straight to CDP with 10s target wait

## 4. DevTools Bridge — Protocol Delegation

- [ ] 4.1 Update `src/daemon/devtools.ts`: hold an optional `CDPBridge` reference; add `useCDP(bridge: CDPBridge)` method
- [ ] 4.2 Update `getTree()`: delegate to `cdpBridge.getTree()` if connected, else legacy WS; clear error message if both unavailable
- [ ] 4.3 Update `inspect(id)`: delegate to `cdpBridge.inspect(id)` if connected, else legacy WS
- [ ] 4.4 Update `find(name)`: delegate to `cdpBridge.find(name)` if connected, else legacy WS
- [ ] 4.5 Update `evaluate(script)`: delegate to `cdpBridge.evaluate(script)` if connected, else legacy WS
- [ ] 4.6 Update `network(idx?)`: delegate to `cdpBridge.getNetwork(idx)` if connected, else legacy network log
- [ ] 4.7 Update `getErrors()` (new method on DevToolsBridge): delegate to `cdpBridge.getErrors()` if connected, else legacy error cache

## 5. Metro Bridge — Error Integration

- [ ] 5.1 Update `getErrors()` in `src/daemon/metro.ts`: accept optional `cdpErrors` string param; prepend CDP runtime errors before Metro build errors
- [ ] 5.2 Update `errors` handler in `src/daemon/index.ts`: pass `devtools.getErrors()` result into `metro.getErrors()`

## 6. Build and Validation

- [ ] 6.1 Run `pnpm build` — confirm zero TypeScript errors
- [ ] 6.2 Manually test `rn open` against a new arch RN 0.73+ app — confirm `Connected via CDP` message and `rn tree` returns component tree
- [ ] 6.3 Manually test `rn open` against a legacy/old arch project — confirm fallback to `Connected via DevTools (legacy)` and `rn tree` still works
- [ ] 6.4 Commit, push to GitHub, bump version to `0.2.0`, publish to npm
