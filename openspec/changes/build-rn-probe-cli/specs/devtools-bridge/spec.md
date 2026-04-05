## ADDED Requirements

### Requirement: Component tree inspection
The system SHALL retrieve and print the full React component tree from the RN DevTools WebSocket (port 8097) as structured indented text.

#### Scenario: Print component tree
- **WHEN** user runs `rn tree`
- **THEN** the CLI prints the component tree with node IDs, display names, and nesting depth indicated by indentation

#### Scenario: DevTools not connected
- **WHEN** port 8097 is not available or no RN app is connected
- **THEN** the CLI prints `RN DevTools not connected. Is your app running with dev mode enabled?`

### Requirement: Single element inspection
The system SHALL inspect a specific component by its node ID, returning props, state, hooks, and source location.

#### Scenario: Inspect by ID
- **WHEN** user runs `rn inspect <id>`
- **THEN** the CLI prints the component's display name, props (key: value), state, hooks, and source file with line number

#### Scenario: Invalid ID
- **WHEN** user runs `rn inspect <id>` with a non-existent ID
- **THEN** the CLI prints `Component <id> not found.`

### Requirement: Component tree search
The system SHALL search the component tree by display name and return matching node IDs.

#### Scenario: Find by name
- **WHEN** user runs `rn find <name>`
- **THEN** the CLI prints all matching components with their node IDs and parent context

#### Scenario: No match
- **WHEN** user runs `rn find <name>` and no components match
- **THEN** the CLI prints `No components matching "<name>" found.`

### Requirement: JavaScript evaluation
The system SHALL evaluate a JavaScript expression in the RN runtime context and return the result.

#### Scenario: Successful eval
- **WHEN** user runs `rn eval "expression"`
- **THEN** the CLI prints the serialized return value of the expression

#### Scenario: Eval throws
- **WHEN** the evaluated expression throws an error
- **THEN** the CLI prints the error message and stack trace

### Requirement: Network request inspection
The system SHALL list intercepted network requests and allow inspecting individual requests by index.

#### Scenario: List network requests
- **WHEN** user runs `rn network`
- **THEN** the CLI prints a numbered list of recent requests: method, URL, status code, duration

#### Scenario: Inspect single request
- **WHEN** user runs `rn network <idx>`
- **THEN** the CLI prints full request and response headers and body for the request at that index

#### Scenario: Network inspection not enabled
- **WHEN** Hermes network inspection is not enabled in the app
- **THEN** the CLI prints `Network inspection requires Hermes with network inspection enabled.`

### Requirement: Performance metrics
The system SHALL report JS thread, UI thread, and render performance metrics from RN DevTools performance events.

#### Scenario: Show perf metrics
- **WHEN** user runs `rn logs perf`
- **THEN** the CLI prints JS thread FPS, UI thread FPS, and recent slow render warnings
