import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execa } from "execa";
import { state, ExpoMode } from "./state.js";

// ── SimulatorBridge ───────────────────────────────────────────────────────────

export class SimulatorBridge {
  private get platform() { return state.platform; }

  // ── Screenshot ───────────────────────────────────────────────────────────────

  async screenshot(udid?: string): Promise<string> {
    const outPath = path.join(os.tmpdir(), `rn-probe-screenshot-${Date.now()}.png`);
    if (this.platform === "ios") {
      const target = udid ?? "booted";
      await execa("xcrun", ["simctl", "io", target, "screenshot", outPath]);
    } else {
      const result = await execa("adb", ["-s", udid ?? await this.adbDevice(), "exec-out", "screencap", "-p"]);
      fs.writeFileSync(outPath, result.stdout);
    }
    return outPath;
  }

  // ── Tap ──────────────────────────────────────────────────────────────────────

  async tap(x: number, y: number, udid?: string): Promise<string> {
    if (this.platform === "ios") {
      await this.cgEventTap(x, y);
    } else {
      await execa("adb", ["-s", udid ?? await this.adbDevice(), "shell", "input", "tap", String(x), String(y)]);
    }
    return `Tapped (${x}, ${y}).`;
  }

  private async cgEventTap(x: number, y: number): Promise<void> {
    // Bring Simulator to front and get window origin
    await execa("osascript", ["-e", 'tell application "Simulator" to activate']);
    const posResult = await execa("osascript", ["-e",
      'tell application "System Events" to tell process "Simulator" to get position of front window',
    ]);
    const [winX, winY] = posResult.stdout.trim().split(", ").map(Number);

    // ~100px of window chrome (title bar + device top bezel at default scale)
    const screenX = Math.round(winX + x);
    const screenY = Math.round(winY + 100 + y);

    const swiftCode = [
      "import CoreGraphics",
      `let pt = CGPoint(x: ${screenX}, y: ${screenY})`,
      "CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: pt, mouseButton: .left)!.post(tap: .cghidEventTap)",
      "CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: pt, mouseButton: .left)!.post(tap: .cghidEventTap)",
    ].join("\n");
    const swiftFile = path.join(os.tmpdir(), `rn-probe-tap-${Date.now()}.swift`);
    fs.writeFileSync(swiftFile, swiftCode);
    try {
      await execa("swift", [swiftFile]);
    } finally {
      fs.unlinkSync(swiftFile);
    }
  }

  private async cgEventSwipe(x1: number, y1: number, x2: number, y2: number): Promise<void> {
    await execa("osascript", ["-e", 'tell application "Simulator" to activate']);
    const posResult = await execa("osascript", ["-e",
      'tell application "System Events" to tell process "Simulator" to get position of front window',
    ]);
    const [winX, winY] = posResult.stdout.trim().split(", ").map(Number);
    const ox = winX, oy = winY + 100;

    const sx1 = Math.round(ox + x1), sy1 = Math.round(oy + y1);
    const sx2 = Math.round(ox + x2), sy2 = Math.round(oy + y2);

    const swiftCode = [
      "import CoreGraphics",
      "import Foundation",
      `let start = CGPoint(x: ${sx1}, y: ${sy1})`,
      `let end = CGPoint(x: ${sx2}, y: ${sy2})`,
      "CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: start, mouseButton: .left)!.post(tap: .cghidEventTap)",
      "for i in 1...10 {",
      "  let t = Double(i) / 10.0",
      "  let pt = CGPoint(x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t)",
      "  CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: pt, mouseButton: .left)!.post(tap: .cghidEventTap)",
      "  Thread.sleep(forTimeInterval: 0.03)",
      "}",
      "CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left)!.post(tap: .cghidEventTap)",
    ].join("\n");
    const swiftFile = path.join(os.tmpdir(), `rn-probe-swipe-${Date.now()}.swift`);
    fs.writeFileSync(swiftFile, swiftCode);
    try {
      await execa("swift", [swiftFile]);
    } finally {
      fs.unlinkSync(swiftFile);
    }
  }

  // ── Swipe ────────────────────────────────────────────────────────────────────

  async swipe(x1: number, y1: number, x2: number, y2: number, udid?: string): Promise<string> {
    if (this.platform === "ios") {
      await this.cgEventSwipe(x1, y1, x2, y2);
    } else {
      await execa("adb", [
        "-s", udid ?? await this.adbDevice(),
        "shell", "input", "swipe",
        String(x1), String(y1), String(x2), String(y2),
      ]);
    }
    return `Swiped from (${x1},${y1}) to (${x2},${y2}).`;
  }

  // ── Viewport ─────────────────────────────────────────────────────────────────

  async viewport(size?: string, udid?: string): Promise<string> {
    if (this.platform === "android") {
      if (size) {
        const [w, h] = size.split("x");
        await execa("adb", ["-s", udid ?? await this.adbDevice(), "shell", "wm", "size", `${w}x${h}`]);
        return `Viewport set to ${w}x${h}.`;
      }
      const result = await execa("adb", ["-s", udid ?? await this.adbDevice(), "shell", "wm", "size"]);
      return `Viewport: ${result.stdout.trim()}`;
    }

    // iOS — read from device info (resize not supported via simctl)
    const result = await execa("xcrun", ["simctl", "list", "devices", "--json"]);
    const data = JSON.parse(result.stdout) as {
      devices: Record<string, Array<{ udid: string; state: string; name: string; deviceTypeIdentifier?: string }>>;
    };
    const booted = Object.values(data.devices)
      .flat()
      .find((d) => d.state === "Booted" && (!udid || d.udid === udid));
    return booted
      ? `Device: ${booted.name} (${booted.udid})\nNote: Viewport resize is not supported on iOS simulator.`
      : "No booted iOS simulator found.";
  }

  // ── Goto ─────────────────────────────────────────────────────────────────────

  async goto(screen: string, expoMode: ExpoMode, scheme?: string, udid?: string): Promise<string> {
    const url = this.buildDeepLink(screen, expoMode, scheme);
    if (this.platform === "ios") {
      await execa("xcrun", ["simctl", "openurl", udid ?? "booted", url]);
    } else {
      await execa("adb", ["-s", udid ?? await this.adbDevice(), "shell", "am", "start",
        "-a", "android.intent.action.VIEW", "-d", url]);
    }
    return `Navigated to ${url}`;
  }

  private buildDeepLink(screen: string, expoMode: ExpoMode, scheme?: string): string {
    if (scheme) {
      return screen.startsWith("/") ? `${scheme}:/${screen}` : `${scheme}://${screen}`;
    }
    if (expoMode === "expo-go") {
      const path = screen.startsWith("/") ? screen : `/${screen}`;
      return `exp://127.0.0.1:8081/--${path}`;
    }
    // bare or dev-build — screen must already be a full URL or we pass as-is
    return screen;
  }

  // ── Back ─────────────────────────────────────────────────────────────────────

  async back(udid?: string): Promise<string> {
    if (this.platform === "ios") {
      // iOS has no hardware back; approximate with a swipe-from-left-edge gesture
      await this.cgEventSwipe(10, 400, 100, 400);
    } else {
      await execa("adb", ["-s", udid ?? await this.adbDevice(), "shell", "input", "keyevent", "BACK"]);
    }
    return "Back triggered.";
  }

  // ── Native logs ───────────────────────────────────────────────────────────────

  async logsNative(bundleId: string, udid?: string): Promise<string> {
    // This command streams — we return instructions since the daemon
    // can't pipe stdout back over IPC. Claude Code should use the CLI
    // which handles streaming directly.
    if (this.platform === "ios") {
      const target = udid ?? "booted";
      return `To stream native logs, run:\nxcrun simctl spawn ${target} log stream --predicate 'subsystem == "${bundleId}"'`;
    }
    return `To stream native logs, run:\nadb logcat | grep "${bundleId}"`;
  }

  // ── Type ─────────────────────────────────────────────────────────────────────

  async type(text: string, udid?: string): Promise<string> {
    if (this.platform === "ios") {
      // Copy text to clipboard then paste via Cmd+V CGEvent
      await execa("bash", ["-c", `printf '%s' ${JSON.stringify(text)} | pbcopy`]);
      const swiftCode = [
        "import CoreGraphics",
        "let cmd: CGEventFlags = .maskCommand",
        "let down = CGEvent(keyboardEventSource: nil, virtualKey: 0x09, keyDown: true)!",
        "let up = CGEvent(keyboardEventSource: nil, virtualKey: 0x09, keyDown: false)!",
        "down.flags = cmd",
        "up.flags = cmd",
        "down.post(tap: .cghidEventTap)",
        "up.post(tap: .cghidEventTap)",
      ].join("\n");
      const swiftFile = path.join(os.tmpdir(), `rn-probe-type-${Date.now()}.swift`);
      fs.writeFileSync(swiftFile, swiftCode);
      try {
        await execa("swift", [swiftFile]);
      } finally {
        fs.unlinkSync(swiftFile);
      }
    } else {
      const encoded = text.replace(/ /g, "%s");
      await execa("adb", ["-s", udid ?? await this.adbDevice(), "shell", "input", "text", encoded]);
    }
    return "Typed text.";
  }

  // ── Android device helper ─────────────────────────────────────────────────────

  private async adbDevice(): Promise<string> {
    const result = await execa("adb", ["devices"]);
    const lines = result.stdout.split("\n").slice(1).filter((l) => l.includes("\tdevice"));
    if (lines.length === 0) throw new Error("No Android device/emulator connected.");
    return lines[0].split("\t")[0].trim();
  }
}
