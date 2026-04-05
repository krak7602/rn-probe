# rn-probe

Claude Code's window into a live React Native app.

A daemon + CLI tool that gives Claude Code structured, text-based introspection into a running RN app — component trees, JS errors, native logs, screenshots, tap events, and more. The same pattern as [`@vercel/next-browser`](https://github.com/vercel-labs/next-browser) applied to React Native.

Works with bare React Native and Expo (Expo Go + dev builds).

---

## Install

```bash
npm install -g @rn-probe/cli
```

Or via the Claude Code skill system:

```bash
npx skills add rn-probe
```

---

## Quick Start

```bash
# Connect to your running dev server
rn open

# For Expo Go
rn open --expo-go

# For Expo dev build
rn open --dev-build

# See what's on screen
rn screenshot

# Inspect the component tree
rn tree

# Drill into a component
rn inspect 42

# Check for errors
rn errors

# Navigate to a screen
rn goto myapp://home

# Close when done
rn close
```

---

## Commands

See [SKILL.md](./SKILL.md) for the full command reference.

---

## Requirements

- Node 22+
- macOS with Xcode CLI tools (for iOS simulator via `xcrun simctl`)
- Android SDK + `adb` (optional, for Android)
- A React Native app running in dev mode (Metro on port 8081, RN DevTools on port 8097)

---

## License

MIT
