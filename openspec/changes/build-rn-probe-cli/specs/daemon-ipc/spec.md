## ADDED Requirements

### Requirement: Daemon runs as a persistent background process
The system SHALL maintain a single long-lived daemon process per machine that holds all stateful connections to Metro, React DevTools, and simulator tools. The daemon SHALL be spawned as a detached child process and persist across CLI invocations.

#### Scenario: Daemon auto-spawns on first command
- **WHEN** a CLI command is executed and no daemon socket exists
- **THEN** the CLI spawns the daemon as a detached background process, waits up to 5 seconds for the socket to appear, then proceeds with the command

#### Scenario: Daemon is already running
- **WHEN** a CLI command is executed and the daemon socket already exists
- **THEN** the CLI connects to the existing socket without spawning a new process

### Requirement: IPC via Unix domain socket
The daemon SHALL expose a Unix domain socket at `/tmp/rn-probe.sock`. All CLI commands communicate with the daemon exclusively via this socket using newline-delimited JSON messages.

#### Scenario: Request-response over socket
- **WHEN** a CLI command sends a JSON request `{"id": "<uuid>", "method": "<command>", "params": {...}}` over the socket
- **THEN** the daemon responds with `{"id": "<uuid>", "result": {...}}` or `{"id": "<uuid>", "error": {"message": "<msg>"}}`

#### Scenario: Stale socket from crashed daemon
- **WHEN** a socket file exists at `/tmp/rn-probe.sock` but no process is listening
- **THEN** the CLI removes the stale socket file and spawns a fresh daemon

### Requirement: Daemon lifecycle commands
The system SHALL support explicit `open` and `close` lifecycle commands. `rn open` connects all bridges; `rn close` tears them down and stops the daemon.

#### Scenario: rn open with defaults
- **WHEN** user runs `rn open` with no arguments
- **THEN** the daemon connects to Metro at `http://localhost:8081`, attempts to connect to RN DevTools at port 8097, and prints the active connections

#### Scenario: rn open with custom Metro URL
- **WHEN** user runs `rn open http://localhost:8082`
- **THEN** the daemon uses the provided URL for all Metro API calls

#### Scenario: rn open with Expo Go flag
- **WHEN** user runs `rn open --expo-go`
- **THEN** the daemon stores `expoMode: "expo-go"` and uses `exp://` scheme for all subsequent deep-link commands

#### Scenario: rn open with dev build flag
- **WHEN** user runs `rn open --dev-build`
- **THEN** the daemon stores `expoMode: "dev-build"` and expects a custom app scheme for deep links

#### Scenario: rn close
- **WHEN** user runs `rn close`
- **THEN** the daemon disconnects all bridges, removes the socket file, and exits cleanly

### Requirement: Graceful shutdown and socket cleanup
The daemon SHALL clean up the socket file on exit, whether from an explicit `rn close`, SIGTERM, SIGINT, or uncaught exception.

#### Scenario: Daemon exits cleanly
- **WHEN** the daemon process exits for any reason
- **THEN** the socket file at `/tmp/rn-probe.sock` is removed

#### Scenario: Force restart via rn open --force
- **WHEN** user runs `rn open --force`
- **THEN** any existing daemon is killed, the socket is removed, and a fresh daemon is spawned
