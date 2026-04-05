import http from "node:http";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";

const METRO_JSON_PATH = "/json";
const REQUEST_TIMEOUT_MS = 8_000; // must be < IPC DEFAULT_TIMEOUT_MS (10s)
const TREE_TIMEOUT_MS = 25_000;   // fiber walk can be slow on large trees
const RECONNECT_DELAY_MS = 1_000;
const TARGET_WAIT_MS = 10_000;
const TARGET_POLL_INTERVAL_MS = 500;
const ERROR_BUFFER_SIZE = 50;
const LOG_BUFFER_SIZE = 500;

// ── CDP protocol types ────────────────────────────────────────────────────────

interface CDPTarget {
  id: string;
  title?: string;
  type?: string;
  webSocketDebuggerUrl: string;
  reactNative?: {
    capabilities?: {
      nativePageReloads?: boolean;
      prefersFuseboxFrontend?: boolean;
    };
  };
}

interface CDPRequest {
  id: string;
  method: string;
  params?: unknown;
}

interface CDPResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

interface CDPEvent {
  method: string;
  params?: unknown;
}

interface RuntimeException {
  timestamp: number;
  exceptionDetails: {
    text: string;
    exception?: { description?: string };
    stackTrace?: { callFrames: Array<{ functionName: string; url: string; lineNumber: number }> };
  };
}

interface NetworkRequest {
  requestId: string;
  method: string;
  url: string;
  status?: number;
  duration?: number;
  requestStartTime?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
}

interface ComponentNode {
  id: number;
  displayName: string | null;
  children: number[];
  props?: Record<string, unknown>;
  state?: unknown;
  hooks?: Array<{ name: string; value: unknown }>;
  source?: { fileName: string; lineNumber: number } | null;
}

// ── CDPBridge ─────────────────────────────────────────────────────────────────

export class CDPBridge {
  private metroUrl: string;
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnecting = false;
  private pendingRequests = new Map<string, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }>();
  private errorBuffer: RuntimeException[] = [];
  private networkLog: Map<string, NetworkRequest> = new Map();
  private consoleLog: string[] = [];
  private executionContextId: number | null = null;

  constructor(metroUrl: string) {
    this.metroUrl = metroUrl;
  }

  get isConnected() { return this.connected; }

  // ── 1.2 Target discovery ──────────────────────────────────────────────────

  async discoverTarget(force = false): Promise<CDPTarget | null> {
    const deadline = Date.now() + (force ? TARGET_WAIT_MS : TARGET_WAIT_MS);
    let attempt = 0;

    while (Date.now() < deadline) {
      if (attempt > 0) {
        process.stdout.write("Waiting for CDP targets...\n");
        await sleep(TARGET_POLL_INTERVAL_MS);
      }
      attempt++;

      const targets = await this.fetchTargets().catch(() => null);
      if (targets === null) return null; // Metro unreachable

      const target =
        targets.find((t) => t.reactNative !== undefined) ??  // RN new arch Fusebox format
        targets.find((t) => t.type === "react-native") ??    // legacy format
        targets[0] ??
        null;

      if (target) return target;
    }

    return null;
  }

  private fetchTargets(): Promise<CDPTarget[]> {
    const url = new URL(this.metroUrl);
    return new Promise((resolve, reject) => {
      const req = http.get(
        { hostname: url.hostname, port: url.port || 8081, path: METRO_JSON_PATH },
        (res) => {
          let data = "";
          res.on("data", (c: Buffer) => { data += c.toString(); });
          res.on("end", () => {
            try { resolve(JSON.parse(data) as CDPTarget[]); }
            catch { resolve([]); }
          });
        }
      );
      req.on("error", reject);
      req.setTimeout(2000, () => { req.destroy(); reject(new Error("timeout")); });
    });
  }

  // ── 1.3 WebSocket connection ──────────────────────────────────────────────

  async connect(forceNewArch = false): Promise<boolean> {
    const target = await this.discoverTarget(forceNewArch);
    if (!target) return false;

    await this.connectToTarget(target.webSocketDebuggerUrl);
    return true;
  }

  private async connectToTarget(wsUrl: string): Promise<void> {
    // Normalise — Metro sometimes returns a relative path
    const fullUrl = wsUrl.startsWith("ws")
      ? wsUrl
      : `ws://localhost:${new URL(this.metroUrl).port || 8081}${wsUrl}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(fullUrl);
      this.ws = ws;

      ws.on("open", () => {
        this.connected = true;
        this.send("Runtime.enable", {});
        this.send("Debugger.enable", {});
        this.send("Network.enable", {});
        this.send("Console.enable", {});
        resolve();
      });

      ws.on("message", (data: WebSocket.RawData) => {
        this.handleMessage(JSON.parse(data.toString()) as CDPResponse & CDPEvent);
      });

      ws.on("close", () => {
        this.connected = false;
        if (!this.reconnecting) this.scheduleReconnect();
      });

      ws.on("error", (err) => {
        if (!this.connected) reject(err);
      });
    });
  }

  // ── 1.5 Reconnect ─────────────────────────────────────────────────────────

  private scheduleReconnect() {
    this.reconnecting = true;
    setTimeout(async () => {
      const target = await this.discoverTarget().catch(() => null);
      if (target) {
        await this.connectToTarget(target.webSocketDebuggerUrl).catch(() => {});
      }
      this.reconnecting = false;
    }, RECONNECT_DELAY_MS);
  }

  disconnect() {
    this.reconnecting = true; // suppress auto-reconnect
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  // ── 1.4 CDP request helper ────────────────────────────────────────────────

  private send(method: string, params: unknown) {
    const msg: CDPRequest = { id: uuidv4(), method, params };
    this.ws?.send(JSON.stringify(msg));
    return msg.id;
  }

  private request<T>(method: string, params?: unknown): Promise<T> {
    return this.requestWithTimeout<T>(method, params, REQUEST_TIMEOUT_MS);
  }

  private requestWithTimeout<T>(method: string, params: unknown, timeout: number): Promise<T> {
    if (!this.connected || !this.ws) {
      throw new Error("CDP not connected.");
    }

    return new Promise<T>((resolve, reject) => {
      const id = uuidv4();
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`CDP request '${method}' timed out`));
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });

      const msg: CDPRequest = { id, method, params };
      this.ws!.send(JSON.stringify(msg));
    });
  }

  private handleMessage(msg: (CDPResponse & CDPEvent)) {
    // Response to a pending request
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Capture execution context ID for Runtime.evaluate calls
    if (msg.method === "Runtime.executionContextCreated" && msg.params) {
      const p = msg.params as { context: { id: number } };
      this.executionContextId = p.context.id;
    }

    // Console log events
    if (msg.method === "Runtime.consoleAPICalled" && msg.params) {
      const p = msg.params as {
        type: string;
        args: Array<{ type: string; value?: unknown; description?: string }>;
      };
      const text = p.args
        .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? "")))
        .join(" ");
      const line = `[${p.type}] ${text}`;
      if (this.consoleLog.length >= LOG_BUFFER_SIZE) this.consoleLog.shift();
      this.consoleLog.push(line);
    }

    // 2.5 Error events
    if (msg.method === "Runtime.exceptionThrown" && msg.params) {
      const exc = msg.params as RuntimeException;
      if (this.errorBuffer.length >= ERROR_BUFFER_SIZE) this.errorBuffer.shift();
      this.errorBuffer.push(exc);
    }

    // 2.6 Network events
    if (msg.method === "Network.requestWillBeSent" && msg.params) {
      const p = msg.params as {
        requestId: string;
        request: { method: string; url: string; headers: Record<string, string>; postData?: string };
        timestamp: number;
      };
      this.networkLog.set(p.requestId, {
        requestId: p.requestId,
        method: p.request.method,
        url: p.request.url,
        requestHeaders: p.request.headers,
        requestBody: p.request.postData,
        requestStartTime: p.timestamp,
      });
    }

    if (msg.method === "Network.responseReceived" && msg.params) {
      const p = msg.params as {
        requestId: string;
        response: { status: number; headers: Record<string, string> };
        timestamp: number;
      };
      const existing = this.networkLog.get(p.requestId);
      if (existing) {
        existing.status = p.response.status;
        existing.responseHeaders = p.response.headers;
        if (existing.requestStartTime) {
          existing.duration = Math.round((p.timestamp - existing.requestStartTime) * 1000);
        }
      }
    }
  }

  // ── 2.1 evaluate ──────────────────────────────────────────────────────────

  async evaluate(script: string): Promise<string> {
    return this.evaluateWithTimeout(script, REQUEST_TIMEOUT_MS);
  }

  private async evaluateWithTimeout(script: string, timeout: number): Promise<string> {
    const params: Record<string, unknown> = {
      expression: script,
      returnByValue: true,
    };
    if (this.executionContextId !== null) params.contextId = this.executionContextId;

    const result = await this.requestWithTimeout<{
      result: { value?: unknown; description?: string };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>("Runtime.evaluate", params, timeout);

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      );
    }

    return JSON.stringify(result.result.value ?? result.result.description, null, 2);
  }

  // ── 2.2 getTree — walks React fiber tree via Runtime.evaluate ────────────

  async getTree(): Promise<string> {
    const script = `(function() {
      try {
        var hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
        if (!hook || !hook.renderers || hook.renderers.size === 0) {
          return '(React DevTools hook not found — is the app running in dev mode?)';
        }
        var lines = [];
        var nodeId = 0;
        hook.renderers.forEach(function(renderer, rendererId) {
          var roots = hook.getFiberRoots
            ? hook.getFiberRoots(rendererId)
            : (renderer.getFiberRoots ? renderer.getFiberRoots() : new Set());
          roots.forEach(function(root) {
            function walk(fiber, depth) {
              if (!fiber || depth > 30 || nodeId > 500) return;
              var name = null;
              if (typeof fiber.type === 'function' || typeof fiber.type === 'object') {
                // Only show named React components, skip host nodes (View, Text, etc.)
                name = (fiber.type && (fiber.type.displayName || fiber.type.name)) || null;
              }
              if (name) lines.push('  '.repeat(depth) + '[' + (nodeId++) + '] ' + name);
              if (fiber.child) walk(fiber.child, depth + (name ? 1 : 0));
              if (fiber.sibling) walk(fiber.sibling, depth);
            }
            walk(root.current, 0);
          });
        });
        return lines.length > 0 ? lines.join('\n') : '(empty tree)';
      } catch(e) { return 'Error walking fiber tree: ' + String(e); }
    })()`;
    return this.evaluateWithTimeout(script, TREE_TIMEOUT_MS);
  }

  // ── 2.3 inspect ───────────────────────────────────────────────────────────

  async inspect(id: string): Promise<string | null> {
    const script = `(function() {
      try {
        var hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
        if (!hook || !hook.renderers || hook.renderers.size === 0) return null;
        var target = null;
        var nodeId = 0;
        var targetIdx = ${Number(id)};
        hook.renderers.forEach(function(renderer) {
          var roots = renderer.getFiberRoots ? renderer.getFiberRoots() : new Set();
          roots.forEach(function(root) {
            function walk(fiber) {
              if (!fiber || target) return;
              var name = null;
              if (typeof fiber.type === 'string') name = fiber.type;
              else if (fiber.type) name = fiber.type.displayName || fiber.type.name || null;
              if (name) { if (nodeId === targetIdx) target = fiber; nodeId++; }
              if (fiber.child) walk(fiber.child);
              if (fiber.sibling) walk(fiber.sibling);
            }
            walk(root.current);
          });
        });
        if (!target) return null;
        var result = { name: null, props: {}, state: null };
        if (typeof target.type === 'string') result.name = target.type;
        else if (target.type) result.name = target.type.displayName || target.type.name || null;
        try { result.props = JSON.parse(JSON.stringify(target.memoizedProps || {})); } catch(e) {}
        try { result.state = JSON.parse(JSON.stringify(target.memoizedState)); } catch(e) {}
        return JSON.stringify(result);
      } catch(e) { return null; }
    })()`;
    const raw = await this.evaluate(script);
    if (!raw || raw === 'null' || raw === '"null"') return null;
    try {
      const text = raw.startsWith('"') ? JSON.parse(raw) : raw;
      const el = JSON.parse(text) as { name: string | null; props: Record<string, unknown>; state: unknown };
      if (!el) return null;
      const lines: string[] = [];
      lines.push(`Component:  ${el.name ?? '(anonymous)'}`);
      if (el.props && Object.keys(el.props).length > 0) {
        lines.push('Props:');
        for (const [k, v] of Object.entries(el.props)) {
          if (k !== 'children') lines.push(`  ${k}: ${JSON.stringify(v)}`);
        }
      }
      if (el.state !== null && el.state !== undefined) {
        lines.push(`State:      ${JSON.stringify(el.state, null, 2)}`);
      }
      return lines.join('\n');
    } catch { return raw; }
  }

  // ── 2.4 find ──────────────────────────────────────────────────────────────

  async find(name: string): Promise<string> {
    const tree = await this.getTree();
    const lower = name.toLowerCase();
    const matches = tree.split('\n').filter((l) => l.toLowerCase().includes(lower));
    if (matches.length === 0) return `No components matching "${name}" found.`;
    return matches.join('\n');
  }

  // ── 2.5 getErrors ─────────────────────────────────────────────────────────

  getErrors(): string {
    if (this.errorBuffer.length === 0) return "";
    return this.errorBuffer
      .map((e) => {
        const msg = e.exceptionDetails.exception?.description ?? e.exceptionDetails.text;
        const frames = e.exceptionDetails.stackTrace?.callFrames ?? [];
        const stack = frames
          .slice(0, 5)
          .map((f) => `  at ${f.functionName || "(anonymous)"} (${f.url}:${f.lineNumber})`)
          .join("\n");
        return stack ? `${msg}\n${stack}` : msg;
      })
      .join("\n\n");
  }

  // ── getLogs ───────────────────────────────────────────────────────────────────

  getLogs(lines: number): string {
    const tail = this.consoleLog.slice(-lines);
    return tail.length > 0 ? tail.join("\n") : "(no console output captured yet — trigger some console.log calls in your app first, or use 'rn logs native' for native logs)";
  }

  // ── dumpTargets (debug) ───────────────────────────────────────────────────────

  async dumpTargets(): Promise<string> {
    const targets = await this.fetchTargets().catch(() => null);
    if (!targets) return "Could not reach Metro /json";
    return targets.map((t, i) =>
      `[${i}] id=${t.id} type=${t.type ?? "n/a"} rn=${t.reactNative ? JSON.stringify(t.reactNative.capabilities) : "n/a"} ws=${t.webSocketDebuggerUrl}`
    ).join("\n") || "(no targets)";
  }

  // ── 2.6 getNetwork ────────────────────────────────────────────────────────

  getNetwork(idx?: number): string {
    const entries = Array.from(this.networkLog.values());
    if (entries.length === 0) return "No network requests captured.";

    if (idx !== undefined) {
      const req = entries[idx];
      if (!req) return `No request at index ${idx}.`;
      const lines = [
        `[${idx}] ${req.method} ${req.url}`,
        `Status:   ${req.status ?? "pending"}`,
        `Duration: ${req.duration !== undefined ? `${req.duration}ms` : "—"}`,
      ];
      if (req.requestHeaders) {
        lines.push("Request Headers:");
        for (const [k, v] of Object.entries(req.requestHeaders)) lines.push(`  ${k}: ${v}`);
      }
      if (req.requestBody) lines.push(`Request Body:\n${req.requestBody}`);
      if (req.responseHeaders) {
        lines.push("Response Headers:");
        for (const [k, v] of Object.entries(req.responseHeaders)) lines.push(`  ${k}: ${v}`);
      }
      return lines.join("\n");
    }

    return entries
      .map((r, i) =>
        `[${i}] ${r.method} ${r.url} — ${r.status ?? "pending"} (${r.duration !== undefined ? `${r.duration}ms` : "—"})`
      )
      .join("\n");
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
