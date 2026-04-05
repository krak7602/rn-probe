---
name: rn-probe
description: Pair-program on a live React Native app — inspect component trees, errors, logs, screenshots, and drive the simulator from Claude Code.
---

# rn-probe

A CLI + daemon tool that gives Claude Code structured, text-based introspection into a live React Native app — the same way `next-browser` does for Next.js in a browser.

## Bootstrap

When `/rn-probe` is invoked:

1. **Check for the CLI**
   ```bash
   rn --version
   ```
   If not found, install it:
   ```bash
   npm install -g @rn-probe/cli
   ```

2. **Ask the user:**
   - Metro URL? (default: `http://localhost:8081`)
   - Target platform? (`ios` / `android`)
   - Project type? (`bare RN` / `Expo dev build` / `Expo Go`)

3. **Connect:**
   ```bash
   rn open [metroUrl] [--expo-go | --dev-build]
   ```
   Omit the flag for bare React Native. `--expo-go` sets the deep-link scheme to `exp://`. `--dev-build` expects a custom app scheme.

You are now in **pair programming mode** — use the commands below to inspect the live app.

---

## Command Reference

### Lifecycle
| Command | Description |
|---|---|
| `rn open [url]` | Connect to Metro + RN DevTools. Flags: `--expo-go`, `--dev-build`, `--force` |
| `rn close` | Tear down daemon and disconnect all bridges |
| `rn restart-metro` | Kill Metro and restart with `--reset-cache` |

### Navigation
| Command | Description |
|---|---|
| `rn goto <screen>` | Deep-link navigate. Use `--scheme <scheme>` to override. |
| `rn back` | Trigger hardware back / navigation pop |
| `rn reload` | Hot-reload the JS bundle |

### Component Inspection
| Command | Description |
|---|---|
| `rn tree` | Print full React component tree (`[id] DisplayName`) |
| `rn inspect <id>` | Inspect component by ID — props, state, hooks, source |
| `rn find <name>` | Search tree by display name, return matching IDs |

### Errors & Logs
| Command | Description |
|---|---|
| `rn errors` | JS errors, RedBox content, Metro build errors |
| `rn logs [--lines N]` | Recent Metro dev server output |
| `rn logs native` | Native device logs filtered to app bundle ID |
| `rn logs perf` | JS/UI thread FPS and slow frame count |

### Visual & Interaction
| Command | Description |
|---|---|
| `rn screenshot` | Save simulator screenshot, print file path |
| `rn tap <x> <y>` | Tap at screen coordinates |
| `rn swipe <x1,y1:x2,y2>` | Swipe gesture between two coordinate pairs |
| `rn viewport [WxH]` | Show or set screen size (e.g. `390x844`) |
| `rn type <text>` | Type text into the focused input |

### Network & Bundle
| Command | Description |
|---|---|
| `rn network [idx]` | List network requests, or inspect one by index |
| `rn bundle-status` | Metro bundle state, module count, warnings |
| `rn eval <script>` | Evaluate JS in the RN runtime |

### Computer Use Escalation
| Command | Description |
|---|---|
| `rn use-computer` | Signal to activate computer use for the current task |

---

## Tool Escalation Order

Always prefer structured commands. Only escalate when the layer below cannot answer.

1. **Structured command** — `rn tree`, `rn inspect`, `rn errors`, etc.
2. **Screenshot + tap** — `rn screenshot` to see the UI, `rn tap` / `rn swipe` to interact
3. **Computer use** — run `rn use-computer` when vision + mouse/keyboard is the only path

Use computer use for:
- Validating that an animation looks correct
- Interacting with GUI-only native controls (e.g. native date pickers, modals)
- Debugging layout issues only visible at runtime
- Walking through onboarding flows that require visual confirmation

---

## Reading `rn tree` Output

Each line is: `[id] DisplayName`, indented by nesting depth.

```
[1] App
  [2] NavigationContainer
    [3] Stack.Navigator
      [4] HomeScreen
        [5] ScrollView
          [6] Text
```

Use the `id` with `rn inspect <id>` to drill into a component.

---

## RN / Expo Gotchas

### Hermes vs JSC
- `rn eval` works differently on Hermes (CDP-based) vs JSC — Hermes is the default since RN 0.70.
- `rn network` requires Hermes **with** network inspection enabled (set `enableNetworkInspector: true` in your Hermes config or Metro config).

### Expo
- **Expo Go** — uses `exp://127.0.0.1:8081/--/<path>` deep links. Pass `--expo-go` at `rn open`.
- **Expo dev build** — uses your custom app scheme (e.g. `myapp://`). Pass `--dev-build`.
- Both Expo modes use the same Metro (port 8081) and RN DevTools (port 8097) — only the deep-link scheme differs.

### Bridge vs Bridgeless
- RN's new architecture (bridgeless mode) does not change the DevTools WebSocket protocol.
- If `rn tree` returns an empty tree, your app may be running in production mode — ensure you started it with `npx react-native start` or `npx expo start`.

### Simulator must be booted
- `rn screenshot`, `rn tap`, and `rn goto` require a booted iOS simulator or connected Android device.
- If the simulator is not booted, run `xcrun simctl boot <UDID>` first or boot it from Xcode.

---

## Global Flags

| Flag | Description |
|---|---|
| `--target <udid>` | Override active simulator/device UDID |
| `--json` | Output raw JSON (useful for piping) |
