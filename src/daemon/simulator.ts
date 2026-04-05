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
      await this.simctlSendTap(x, y, udid ?? "booted");
    } else {
      await execa("adb", ["-s", udid ?? await this.adbDevice(), "shell", "input", "tap", String(x), String(y)]);
    }
    return `Tapped (${x}, ${y}).`;
  }

  private async simctlSendTap(x: number, y: number, target: string): Promise<void> {
    // idb is the only reliable way to send touch events to iOS simulator.
    // Install with: brew install idb-companion
    const udid = target === "booted" ? await this.bootedUdid() : target;
    try {
      await execa("idb", ["ui", "tap", String(x), String(y), "--udid", udid]);
      return;
    } catch (err: unknown) {
      const msg = (err as { code?: string; message?: string }).code === "ENOENT"
        ? "idb not found. Install with: brew install idb-companion"
        : `idb tap failed: ${(err as Error).message}`;
      throw new Error(msg);
    }
  }

  private async bootedUdid(): Promise<string> {
    const result = await execa("xcrun", ["simctl", "list", "devices", "--json"]);
    const data = JSON.parse(result.stdout) as {
      devices: Record<string, Array<{ udid: string; state: string }>>;
    };
    const booted = Object.values(data.devices)
      .flat()
      .find((d) => d.state === "Booted");
    if (!booted) throw new Error("No booted iOS simulator found.");
    return booted.udid;
  }

  // ── Swipe ────────────────────────────────────────────────────────────────────

  async swipe(x1: number, y1: number, x2: number, y2: number, udid?: string): Promise<string> {
    if (this.platform === "ios") {
      const target = udid ?? "booted";
      const resolvedUdid = target === "booted" ? await this.bootedUdid() : target;
      try {
        await execa("idb", ["ui", "swipe", String(x1), String(y1), String(x2), String(y2), "--udid", resolvedUdid]);
      } catch (err: unknown) {
        const msg = (err as { code?: string }).code === "ENOENT"
          ? "idb not found. Install with: brew install idb-companion"
          : `idb swipe failed: ${(err as Error).message}`;
        throw new Error(msg);
      }
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
      // iOS has no hardware back; send a swipe-from-left gesture as approximation
      await execa("xcrun", ["simctl", "io", udid ?? "booted", "sendEvent", "--swipe", "10,400:100,400"]);
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
      // xcrun simctl doesn't have a direct "type text" command;
      // use keyboard events character by character via AppleScript as best effort
      await execa("xcrun", ["simctl", "io", udid ?? "booted", "sendEvent", "--text", text]);
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
