## ADDED Requirements

### Requirement: CDP target discovery
The system SHALL discover available Hermes debugging targets by querying Metro's inspector proxy at `GET http://localhost:8081/json`. Discovery SHALL retry with backoff for up to 10 seconds after `rn open` to account for slow app startup.

#### Scenario: Targets found
- **WHEN** `GET /json` returns a non-empty array of targets
- **THEN** the CDPBridge selects the target with `type: "react-native"` or the first target if none match, and stores its `webSocketDebuggerUrl`

#### Scenario: No targets yet (app still loading)
- **WHEN** `GET /json` returns an empty array within the 10s window
- **THEN** the CDPBridge retries every 500ms and prints `Waiting for CDP targets...` on each attempt

#### Scenario: Metro unreachable
- **WHEN** `GET /json` fails with a connection error
- **THEN** CDPBridge returns `null` (caller falls back to legacy port 8097)

### Requirement: CDP WebSocket connection
The system SHALL connect to the selected target's `webSocketDebuggerUrl` and maintain the connection, reconnecting after app reloads.

#### Scenario: Successful connection
- **WHEN** CDPBridge connects to the `webSocketDebuggerUrl`
- **THEN** it sends `Runtime.enable` and `Network.enable` to activate event subscriptions

#### Scenario: Reconnect after reload
- **WHEN** the CDP WebSocket closes (app reloaded, new target URL issued)
- **THEN** CDPBridge re-probes `/json` to get the new `webSocketDebuggerUrl` and reconnects within 2 seconds

### Requirement: JS evaluation via CDP
The system SHALL evaluate JavaScript expressions in the Hermes runtime using `Runtime.evaluate`.

#### Scenario: Successful eval
- **WHEN** `evaluate(script)` is called
- **THEN** CDPBridge sends `{ method: "Runtime.evaluate", params: { expression: script, returnByValue: true, awaitPromise: true } }` and returns the serialized result value

#### Scenario: Eval throws
- **WHEN** the expression throws or `exceptionDetails` is present in the response
- **THEN** CDPBridge throws an Error with the exception description

### Requirement: Component tree via ReactDevTools CDP extension
The system SHALL retrieve the React component tree using the `ReactDevTools.getComponentTree` CDP command exposed by Metro.

#### Scenario: Component tree retrieved
- **WHEN** `getTree()` is called and `ReactDevTools` domain is available
- **THEN** CDPBridge sends `ReactDevTools.getComponentTree` and returns the structured node list

#### Scenario: ReactDevTools domain unavailable
- **WHEN** `ReactDevTools.getComponentTree` returns a method-not-found error
- **THEN** CDPBridge throws with message: `Component tree not available. Open React Native DevTools (press j in Metro) to enable inspection.`

### Requirement: Element inspection via ReactDevTools CDP extension
The system SHALL inspect a specific component by node ID using `ReactDevTools.inspectElement`.

#### Scenario: Inspect by ID
- **WHEN** `inspect(id)` is called
- **THEN** CDPBridge sends `ReactDevTools.inspectElement` with the given ID and returns props, state, hooks, and source location

#### Scenario: Element not found
- **WHEN** the response indicates the ID does not exist
- **THEN** CDPBridge returns `null`

### Requirement: JS error capture via Runtime events
The system SHALL capture runtime JS errors by subscribing to `Runtime.exceptionThrown` CDP events.

#### Scenario: Runtime exception captured
- **WHEN** a JS exception is thrown in the app
- **THEN** CDPBridge stores the exception details (message, stack, timestamp) in an in-memory error buffer (max 50 entries)

#### Scenario: Error buffer queried
- **WHEN** `getErrors()` is called
- **THEN** CDPBridge returns all buffered errors formatted with message and stack trace, or `"No errors."` if empty

### Requirement: Network event capture via Network domain
The system SHALL capture network requests by subscribing to `Network.requestWillBeSent` and `Network.responseReceived` CDP events.

#### Scenario: Network events captured
- **WHEN** the app makes an HTTP request
- **THEN** CDPBridge correlates request and response events by `requestId` and stores them in the network log

#### Scenario: Network log queried
- **WHEN** `getNetwork(idx?)` is called
- **THEN** CDPBridge returns the same format as the legacy DevTools network output
