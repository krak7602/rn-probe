## ADDED Requirements

### Requirement: Screenshot capture
The system SHALL capture a full screenshot of the simulator/emulator and return the file path.

#### Scenario: iOS screenshot
- **WHEN** user runs `rn screenshot` on a system with a booted iOS simulator
- **THEN** the CLI saves a PNG to a temp path using `xcrun simctl io booted screenshot` and prints the absolute file path

#### Scenario: Android screenshot
- **WHEN** user runs `rn screenshot` on a system with a running Android emulator/device
- **THEN** the CLI captures the screen via `adb exec-out screencap -p` and prints the absolute file path

### Requirement: Tap gesture
The system SHALL send a tap event at specified screen coordinates.

#### Scenario: iOS tap
- **WHEN** user runs `rn tap <x> <y>` on iOS
- **THEN** the CLI sends a tap at (x, y) via `xcrun simctl io booted sendEvent` and prints `Tapped (x, y).`

#### Scenario: Android tap
- **WHEN** user runs `rn tap <x> <y>` on Android
- **THEN** the CLI sends a tap via `adb shell input tap <x> <y>` and prints `Tapped (x, y).`

### Requirement: Swipe gesture
The system SHALL send a swipe gesture between two coordinate pairs.

#### Scenario: iOS swipe
- **WHEN** user runs `rn swipe <x1,y1> <x2,y2>` on iOS
- **THEN** the CLI sends a swipe gesture via `xcrun simctl io booted sendEvent` and prints `Swiped from (x1,y1) to (x2,y2).`

#### Scenario: Android swipe
- **WHEN** user runs `rn swipe <x1,y1> <x2,y2>` on Android
- **THEN** the CLI sends a swipe via `adb shell input swipe <x1> <y1> <x2> <y2>` and prints `Swiped from (x1,y1) to (x2,y2).`

### Requirement: Viewport inspection and configuration
The system SHALL report the current simulator screen size and optionally resize it.

#### Scenario: Query viewport
- **WHEN** user runs `rn viewport`
- **THEN** the CLI prints the current screen width and height in pixels

#### Scenario: Set viewport size (Android)
- **WHEN** user runs `rn viewport 390x844` on Android
- **THEN** the CLI sets the screen size via `adb shell wm size 390x844` and prints the new dimensions

### Requirement: Deep-link navigation
The system SHALL navigate the app to a screen via deep link using the scheme appropriate for the active Expo mode.

#### Scenario: Bare RN deep link
- **WHEN** user runs `rn goto myapp://screen` in bare RN mode
- **THEN** the CLI opens the URL via `xcrun simctl openurl booted myapp://screen` or `adb shell am start -a android.intent.action.VIEW -d myapp://screen`

#### Scenario: Expo Go deep link
- **WHEN** user runs `rn goto /screen` in Expo Go mode
- **THEN** the CLI constructs `exp://127.0.0.1:8081/--/screen` and opens it via the appropriate simulator command

#### Scenario: Override scheme
- **WHEN** user runs `rn goto /screen --scheme myapp`
- **THEN** the CLI uses `myapp://screen` regardless of the active Expo mode

### Requirement: Back navigation
The system SHALL trigger the hardware back action or navigation pop.

#### Scenario: iOS back
- **WHEN** user runs `rn back` on iOS
- **THEN** the CLI sends a back gesture via the simulator

#### Scenario: Android back
- **WHEN** user runs `rn back` on Android
- **THEN** the CLI sends `adb shell input keyevent BACK` and prints `Back triggered.`

### Requirement: Native log streaming
The system SHALL stream native device logs filtered to the app's bundle ID.

#### Scenario: iOS native logs
- **WHEN** user runs `rn logs native` on iOS
- **THEN** the CLI runs `xcrun simctl spawn booted log stream --predicate 'subsystem == "<bundleId>"'` and streams output until Ctrl-C

#### Scenario: Android native logs
- **WHEN** user runs `rn logs native` on Android
- **THEN** the CLI runs `adb logcat` filtered to the app's process tag and streams output until Ctrl-C

### Requirement: Text input
The system SHALL type text into the currently focused input field.

#### Scenario: iOS type
- **WHEN** user runs `rn type "hello world"` on iOS
- **THEN** the CLI sends keyboard events for each character via `xcrun simctl io booted sendEvent`

#### Scenario: Android type
- **WHEN** user runs `rn type "hello world"` on Android
- **THEN** the CLI sends `adb shell input text "hello%20world"` (URL-encoded) and prints `Typed text.`
