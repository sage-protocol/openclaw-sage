import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { spawnCommand, type SpawnedProcess } from "./runtime.js";

/** MCP tool definition returned by tools/list */
export type McpToolDef = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  /** Tool category (from Sage MCP registry) */
  annotations?: Record<string, unknown>;
};

/** JSON-RPC request/response types */
type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const MAX_RETRIES = 3;
const RESTART_DELAY_MS = 1000;

/**
 * Lightweight MCP stdio client.
 *
 * Spawns a child process that speaks JSON-RPC over stdin/stdout (MCP stdio transport).
 * Provides methods to list tools and call them.
 */
export class McpBridge extends EventEmitter {
  private proc: SpawnedProcess | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private ready = false;
  private retries = 0;
  private stopped = false;

  private clientVersion: string;

  constructor(
    private command: string,
    private args: string[],
    private env?: Record<string, string>,
    opts?: { clientVersion?: string },
  ) {
    super();
    this.clientVersion = opts?.clientVersion ?? "0.0.0";
  }

  /** Whether the bridge is connected and ready for requests */
  isReady(): boolean {
    return this.ready && this.proc !== null && !this.stopped;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.spawn();
    await this.initialize();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    this.rejectAll("Bridge stopped");

    const proc = this.proc;
    this.proc = null;
    if (!proc) return;

    await this.terminateProcess(proc);
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = (await this.request("tools/list", {})) as { tools?: McpToolDef[] };
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };

    if (result?.isError) {
      const text = result.content?.map((c) => c.text ?? "").join("\n") ?? "MCP tool error";
      throw new Error(text);
    }

    return result;
  }

  // ── private ──────────────────────────────────────────────────────────

  private spawn(): Promise<void> {
    return new Promise((resolve, reject) => {
      void spawnCommand(this.command, this.args, {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: this.env,
      })
        .then((proc) => {
          proc.onError((err) => {
            if (!this.stopped) {
              this.handleCrash(err);
            }
          });

          proc.onExit((code) => {
            if (!this.stopped && code !== 0) {
              this.handleCrash(new Error(`MCP process exited with code ${code}`));
            }
          });

          if (!proc.stdout || !proc.stdin) {
            reject(new Error("Failed to open stdio pipes for MCP process"));
            return;
          }

          this.proc = proc;
          proc.stdout.onLine((line) => this.handleLine(line));
          proc.stderr?.onLine((line) => this.emit("log", line));
          resolve();
        })
        .catch((err) => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  private async initialize(): Promise<void> {
    const result = (await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "openclaw-sage-plugin", version: this.clientVersion },
    })) as { serverInfo?: { name?: string } };

    this.notify("notifications/initialized", {});
    this.ready = true;
    this.retries = 0;
    this.emit("ready", result?.serverInfo);
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin?.isWritable()) {
        reject(new Error("MCP process not running"));
        return;
      }

      const id = randomUUID();
      const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(req) + "\n");
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.proc?.stdin?.isWritable()) return;
    const msg = { jsonrpc: "2.0", method, params };
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  private terminateProcess(proc: SpawnedProcess): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let sigkillTimer: ReturnType<typeof setTimeout> | null = null;
      let resolveTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (sigkillTimer) clearTimeout(sigkillTimer);
        if (resolveTimer) clearTimeout(resolveTimer);
        resolve();
      };

      proc.onExit(() => finish());
      proc.onError(() => finish());

      try {
        proc.stdin?.end();
      } catch {
        // Already closed.
      }

      try {
        proc.kill("SIGTERM");
      } catch {
        finish();
        return;
      }

      sigkillTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Already exited.
        }
      }, 500);
      resolveTimer = setTimeout(() => finish(), 2_000);
    });
  }

  private handleLine(line: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (!msg.id) return;

    const id = String(msg.id);
    const pending = this.pending.get(id);
    if (!pending) return;

    this.pending.delete(id);

    if (msg.error) {
      pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  private async handleCrash(err: Error): Promise<void> {
    this.ready = false;
    this.rejectAll(`MCP process crashed: ${err.message}`);

    if (this.retries >= MAX_RETRIES) {
      this.emit("error", new Error(`MCP bridge failed after ${MAX_RETRIES} retries: ${err.message}`));
      return;
    }

    this.retries++;
    this.emit("log", `MCP process crashed, retry ${this.retries}/${MAX_RETRIES}...`);

    await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));

    if (!this.stopped) {
      try {
        await this.spawn();
        await this.initialize();
      } catch (retryErr) {
        this.handleCrash(retryErr instanceof Error ? retryErr : new Error(String(retryErr)));
      }
    }
  }

  private rejectAll(reason: string): void {
    for (const [, { reject }] of this.pending) {
      reject(new Error(reason));
    }
    this.pending.clear();
  }
}
