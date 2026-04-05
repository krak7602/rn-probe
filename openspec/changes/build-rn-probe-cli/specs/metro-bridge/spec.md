## ADDED Requirements

### Requirement: Bundle status reporting
The system SHALL query Metro's HTTP API and report the current bundle status including modules loaded, warnings, and build time.

#### Scenario: Successful bundle status
- **WHEN** user runs `rn bundle-status`
- **THEN** the CLI prints bundle state (building/ready), module count, build duration, and any active warnings from `GET /status`

#### Scenario: Metro unreachable
- **WHEN** Metro is not running at the configured URL
- **THEN** the CLI prints an error: `Metro not reachable at <url>. Is your dev server running?`

### Requirement: JS error reporting
The system SHALL surface JavaScript errors, RN RedBox content, and Metro build errors as structured text.

#### Scenario: Active JS errors
- **WHEN** user runs `rn errors` and there are active JS errors
- **THEN** the CLI prints each error with its message, stack trace, and source location

#### Scenario: No errors
- **WHEN** user runs `rn errors` and no errors are present
- **THEN** the CLI prints `No errors.`

#### Scenario: Metro build error
- **WHEN** Metro has a build error (e.g., syntax error in source)
- **THEN** `rn errors` includes the Metro build error with file path and line number

### Requirement: Metro log streaming
The system SHALL stream recent Metro dev server output.

#### Scenario: Streaming logs
- **WHEN** user runs `rn logs`
- **THEN** the CLI prints the last N lines of Metro stdout and streams new lines until Ctrl-C

#### Scenario: rn logs with line limit
- **WHEN** user runs `rn logs --lines 50`
- **THEN** the CLI prints the last 50 lines of Metro output

### Requirement: Bundle reload
The system SHALL trigger a JavaScript bundle reload (hot reload) on demand.

#### Scenario: Reload succeeds
- **WHEN** user runs `rn reload`
- **THEN** the daemon sends a reload signal to Metro and prints `Reload triggered.`

### Requirement: Metro restart
The system SHALL support killing and restarting the Metro bundler with cache cleared.

#### Scenario: Metro restart
- **WHEN** user runs `rn restart-metro`
- **THEN** the daemon kills the Metro process, clears the JS cache (`--reset-cache`), restarts Metro, waits for it to become ready, and prints `Metro restarted.`
