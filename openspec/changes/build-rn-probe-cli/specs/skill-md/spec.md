## ADDED Requirements

### Requirement: SKILL.md bootstrap flow
The system SHALL include a `SKILL.md` file that Claude Code loads when the `/rn-probe` skill is invoked. The bootstrap flow SHALL check for the CLI, install if missing, ask configuration questions, and enter pair-programming mode.

#### Scenario: First-time invocation
- **WHEN** Claude Code invokes `/rn-probe` and `@rn-probe/cli` is not globally installed
- **THEN** the skill instructs Claude Code to run `npm install -g @rn-probe/cli`, then proceed with configuration questions

#### Scenario: Already installed
- **WHEN** Claude Code invokes `/rn-probe` and the CLI is already installed
- **THEN** the skill skips installation and proceeds directly to configuration questions

#### Scenario: Bootstrap questions
- **WHEN** the skill reaches the configuration step
- **THEN** Claude Code asks: (1) Metro URL (default: http://localhost:8081), (2) target platform (iOS simulator / Android emulator / device), (3) project type (bare RN / Expo dev build / Expo Go)

#### Scenario: Daemon connection after bootstrap
- **WHEN** bootstrap questions are answered
- **THEN** Claude Code runs `rn open <metroUrl> [--expo-go | --dev-build]` and enters pair-programming mode

### Requirement: Command cheat sheet in SKILL.md
The SKILL.md SHALL include a complete command reference so Claude Code does not need to guess syntax. The cheat sheet SHALL cover all commands with their arguments and flags.

#### Scenario: Claude Code reads cheat sheet
- **WHEN** Claude Code reads SKILL.md
- **THEN** it can determine the exact syntax for every `rn` command without running `rn --help`

### Requirement: Tool escalation guidance in SKILL.md
The SKILL.md SHALL define Claude Code's tool hierarchy: structured commands first, screenshot+tap second, computer use last.

#### Scenario: Escalation ladder followed
- **WHEN** a structured `rn` command cannot answer the question (e.g., visual animation validation)
- **THEN** SKILL.md guides Claude Code to first try `rn screenshot` + `rn tap`, then escalate to `rn use-computer` only if vision+interaction is required

### Requirement: RN/Expo gotchas documented in SKILL.md
The SKILL.md SHALL document RN-specific gotchas that affect how Claude Code interprets command output.

#### Scenario: Hermes vs JSC note
- **WHEN** Claude Code reads SKILL.md
- **THEN** it learns that `rn eval` behavior differs between Hermes and JSC, and that network inspection requires Hermes

#### Scenario: Expo deep-link note
- **WHEN** Claude Code reads SKILL.md
- **THEN** it learns that Expo Go uses `exp://` deep links, dev builds use a custom scheme, and both use the same Metro + DevTools ports

### Requirement: npx skills add compatibility
The package SHALL be publishable to npm and installable via `npx skills add rn-probe`, conforming to the skills.sh packaging convention.

#### Scenario: Install via skills add
- **WHEN** user runs `npx skills add rn-probe` in a project
- **THEN** the SKILL.md is copied into the project's `.claude/skills/` directory and becomes available as `/rn-probe` in Claude Code
