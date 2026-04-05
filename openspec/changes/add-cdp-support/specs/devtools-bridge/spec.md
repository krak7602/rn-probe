## MODIFIED Requirements

### Requirement: Component tree inspection
The system SHALL retrieve and print the full React component tree as structured indented text. It SHALL first attempt CDP (new arch), then fall back to the legacy DevTools WebSocket on port 8097.

#### Scenario: Print component tree (CDP path)
- **WHEN** user runs `rn tree` and CDPBridge is connected
- **THEN** the CLI prints the component tree retrieved via `ReactDevTools.getComponentTree` with node IDs and indentation

#### Scenario: Print component tree (legacy fallback)
- **WHEN** user runs `rn tree` and CDPBridge is not available but port 8097 is connected
- **THEN** the CLI prints the component tree retrieved via the legacy DevTools WebSocket protocol

#### Scenario: Neither path available
- **WHEN** user runs `rn tree` and both CDP and port 8097 are unavailable
- **THEN** the CLI prints: `RN DevTools not connected. Run 'rn open' first, or ensure your app is running in dev mode.`

### Requirement: Single element inspection
The system SHALL inspect a specific component by node ID using CDP if available, falling back to port 8097.

#### Scenario: Inspect by ID (CDP path)
- **WHEN** user runs `rn inspect <id>` and CDPBridge is connected
- **THEN** the CLI prints props, state, hooks, and source via `ReactDevTools.inspectElement`

#### Scenario: Inspect by ID (legacy fallback)
- **WHEN** user runs `rn inspect <id>` and only port 8097 is available
- **THEN** the CLI prints props, state, hooks, and source via the legacy `inspectElement` message

#### Scenario: Invalid ID
- **WHEN** user runs `rn inspect <id>` with a non-existent ID
- **THEN** the CLI prints `Component <id> not found.`

### Requirement: JS errors reporting
The system SHALL report JS errors using CDP `Runtime.exceptionThrown` events on new arch, and the legacy DevTools error events on old arch.

#### Scenario: Errors via CDP
- **WHEN** user runs `rn errors` and CDPBridge is active
- **THEN** the CLI returns errors from the CDPBridge error buffer

#### Scenario: Errors via legacy
- **WHEN** user runs `rn errors` and only port 8097 is available
- **THEN** the CLI returns errors from the legacy DevTools error event cache

## ADDED Requirements

### Requirement: Protocol auto-detection at open
The system SHALL automatically select the appropriate protocol (CDP vs legacy) when `rn open` is called, based on whether Metro's `/json` endpoint returns valid targets.

#### Scenario: New arch detected
- **WHEN** `rn open` is called and `GET /json` returns at least one target
- **THEN** the daemon activates CDPBridge and prints `Connected via CDP (new architecture)`

#### Scenario: Legacy arch detected
- **WHEN** `rn open` is called and `GET /json` returns empty or fails
- **THEN** the daemon activates the legacy DevTools WebSocket and prints `Connected via DevTools (legacy architecture)`

#### Scenario: --new-arch flag forces CDP
- **WHEN** `rn open --new-arch` is called
- **THEN** the daemon skips auto-detection and activates CDPBridge directly, waiting up to 10s for a target to appear
