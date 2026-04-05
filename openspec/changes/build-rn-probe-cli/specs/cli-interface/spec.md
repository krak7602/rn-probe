## ADDED Requirements

### Requirement: CLI entry point via Commander.js
The system SHALL expose a single `rn` binary built with Commander.js. Each subcommand SHALL be a stateless one-shot that connects to the daemon, sends a request, prints the response to stdout, and exits.

#### Scenario: Command dispatches to daemon
- **WHEN** user runs any `rn <command>` subcommand
- **THEN** the CLI connects to the daemon socket, sends the appropriate IPC request, prints the structured result to stdout, and exits with code 0

#### Scenario: Command fails
- **WHEN** the daemon returns an error response
- **THEN** the CLI prints the error message to stderr and exits with code 1

### Requirement: Structured human-readable output
The system SHALL print output as structured human-readable text optimized for parsing by Claude Code. Each command's output SHALL use consistent labeling (e.g., `Component ID: 42`, `Props:`) and indentation.

#### Scenario: Component tree output format
- **WHEN** user runs `rn tree`
- **THEN** output is indented with 2 spaces per level, each node shows `[<id>] <DisplayName>` format

#### Scenario: Inspect output format
- **WHEN** user runs `rn inspect <id>`
- **THEN** output shows labeled sections: `Component:`, `Props:`, `State:`, `Hooks:`, `Source:`

### Requirement: Global --target flag for multi-device support
The system SHALL support a `--target <udid>` global flag that overrides the default active simulator/device.

#### Scenario: Explicit target
- **WHEN** user runs `rn screenshot --target <udid>`
- **THEN** the CLI passes the target UDID to the daemon which routes the command to that specific device

#### Scenario: No target (default)
- **WHEN** user runs any command without `--target`
- **THEN** the CLI uses the booted simulator or first connected device

### Requirement: --json flag for machine-readable output
The system SHALL support a `--json` flag on any command to output raw JSON instead of human-readable text.

#### Scenario: JSON output
- **WHEN** user runs `rn tree --json`
- **THEN** the CLI prints the raw JSON response from the daemon with no formatting

### Requirement: Computer use escalation signal
The system SHALL provide a `rn use-computer` command that signals Claude Code to activate computer use for the current task.

#### Scenario: use-computer invoked
- **WHEN** user (via Claude Code) runs `rn use-computer`
- **THEN** the CLI prints a structured message instructing Claude Code to switch to computer use mode, with context about why programmatic paths are exhausted
