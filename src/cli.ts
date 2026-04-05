#!/usr/bin/env node
import { Command } from "commander";
import { sendRequest, removeStaleSocket } from "./ipc.js";
import { ensureDaemon } from "./spawn.js";

const program = new Command();
program
  .name("rn")
  .description("rn-probe — Claude Code's window into a live React Native app")
  .version("0.1.0")
  .option("--target <udid>", "Override active simulator/device UDID")
  .option("--json", "Output raw JSON instead of human-readable text");

// ── Helper: send a request, auto-spawning the daemon if needed ────────────────

async function dispatch(method: string, params?: Record<string, unknown>): Promise<void> {
  await ensureDaemon();
  const opts = program.opts<{ json?: boolean; target?: string }>();
  const merged = { ...(params ?? {}), ...(opts.target ? { udid: opts.target } : {}) };
  const result = await sendRequest(method, merged);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

program
  .command("open [metroUrl]")
  .description("Connect to Metro + RN DevTools, optionally boot simulator")
  .option("--expo-go", "Use exp:// deep-link scheme (Expo Go)")
  .option("--dev-build", "Use custom app scheme (Expo dev build)")
  .option("--force", "Kill existing daemon and restart")
  .action(async (metroUrl: string | undefined, opts: { expoGo?: boolean; devBuild?: boolean; force?: boolean }) => {
    if (opts.force) removeStaleSocket();
    const expoMode = opts.expoGo ? "expo-go" : opts.devBuild ? "dev-build" : "bare";
    await dispatch("open", { metroUrl, expoMode });
  });

program
  .command("close")
  .description("Tear down daemon and disconnect all bridges")
  .action(async () => {
    try {
      await dispatch("close");
    } catch {
      // Daemon may have already exited
      console.log("Daemon stopped.");
    }
  });

// ── Metro ─────────────────────────────────────────────────────────────────────

program
  .command("bundle-status")
  .description("Show Metro bundle status")
  .action(() => dispatch("bundle-status"));

program
  .command("errors")
  .description("Show JS errors, RedBox content, and Metro build errors")
  .action(() => dispatch("errors"));

program
  .command("reload")
  .description("Trigger JS bundle reload")
  .action(() => dispatch("reload"));

program
  .command("restart-metro")
  .description("Kill and restart Metro bundler with cache cleared")
  .action(() => dispatch("restart-metro"));

// ── Logs subcommand ───────────────────────────────────────────────────────────

const logs = program
  .command("logs")
  .description("Stream Metro dev server output")
  .option("--lines <n>", "Number of lines to show", "50")
  .action(async (opts: { lines: string }) => {
    await dispatch("logs", { lines: Number(opts.lines) });
  });

logs
  .command("native")
  .description("Stream native device logs filtered to your app")
  .action(() => dispatch("logs-native"));

logs
  .command("perf")
  .description("Show JS/UI thread performance metrics")
  .action(() => dispatch("logs-perf"));

// ── Navigation ────────────────────────────────────────────────────────────────

program
  .command("goto <screen>")
  .description("Deep-link navigate to a screen")
  .option("--scheme <scheme>", "Override deep-link scheme")
  .action((screen: string, opts: { scheme?: string }) => dispatch("goto", { screen, scheme: opts.scheme }));

program
  .command("back")
  .description("Trigger hardware back / navigation pop")
  .action(() => dispatch("back"));

// ── Component inspection ──────────────────────────────────────────────────────

program
  .command("tree")
  .description("Print full React component tree")
  .action(() => dispatch("tree"));

program
  .command("inspect <id>")
  .description("Inspect a component by ID: props, state, hooks, source")
  .action((id: string) => dispatch("inspect", { id }));

program
  .command("find <name>")
  .description("Search component tree by display name")
  .action((name: string) => dispatch("find", { name }));

// ── JS eval ───────────────────────────────────────────────────────────────────

program
  .command("eval <script>")
  .description("Evaluate JS in the RN runtime context")
  .action((script: string) => dispatch("eval", { script }));

// ── Network ───────────────────────────────────────────────────────────────────

program
  .command("network [idx]")
  .description("List intercepted network requests, or inspect one by index")
  .action((idx: string | undefined) => dispatch("network", idx !== undefined ? { idx: Number(idx) } : {}));

// ── Visual & interaction ──────────────────────────────────────────────────────

program
  .command("screenshot")
  .description("Save simulator screenshot to tmp file, print path")
  .action(() => dispatch("screenshot"));

program
  .command("tap <x> <y>")
  .description("Send a tap event at coordinates")
  .action((x: string, y: string) => dispatch("tap", { x: Number(x), y: Number(y) }));

program
  .command("swipe <coords>")
  .description("Send a swipe gesture — format: x1,y1:x2,y2")
  .action((coords: string) => {
    const [from, to] = coords.split(":");
    const [x1, y1] = from.split(",").map(Number);
    const [x2, y2] = to.split(",").map(Number);
    return dispatch("swipe", { x1, y1, x2, y2 });
  });

program
  .command("viewport [size]")
  .description("Show or set simulator screen size (e.g. 390x844)")
  .action((size: string | undefined) => dispatch("viewport", { size }));

program
  .command("type <text>")
  .description("Type text into the currently focused input")
  .action((text: string) => dispatch("type", { text }));

// ── Computer use escalation ───────────────────────────────────────────────────

program
  .command("use-computer")
  .description("Signal Claude Code to activate computer use for the current task")
  .action(() => {
    console.log(
      [
        "USE-COMPUTER-ESCALATION",
        "─────────────────────────────────────────────────────",
        "All programmatic inspection paths have been exhausted.",
        "Activate computer use (vision + mouse/keyboard) to proceed.",
        "",
        "Suggested actions:",
        "  • Take a screenshot with your computer use tool",
        "  • Click, scroll, or interact with the simulator visually",
        "  • Validate animations, layout, or GUI-only native controls",
        "─────────────────────────────────────────────────────",
      ].join("\n")
    );
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
