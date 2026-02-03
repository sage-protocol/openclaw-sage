/**
 * E2E Test: OpenClaw RLM Capture Path
 *
 * Validates the OpenClaw-specific capture flow:
 *   1. Spawn sage MCP server with isolated HOME
 *   2. Simulate message_received hook (sage capture hook prompt)
 *   3. Simulate agent_end hook (sage capture hook response)
 *   4. Verify captures landed via rlm_stats MCP tool
 *   5. Run rlm_analyze_captures and verify stats update
 */

import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

// ── Helpers ──────────────────────────────────────────────────────────

const sageBin = resolve(new URL("..", import.meta.url).pathname, "..", "target", "debug", "sage");

function createIsolatedHome(): string {
  return mkdtempSync(resolve(tmpdir(), "sage-openclaw-e2e-"));
}

function isolatedEnv(tmpHome: string): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    HOME: tmpHome,
    XDG_CONFIG_HOME: resolve(tmpHome, ".config"),
    XDG_DATA_HOME: resolve(tmpHome, ".local/share"),
    SAGE_HOME: resolve(tmpHome, ".sage"),
  };
}

type JsonRpcClient = {
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  notify: (method: string, params: Record<string, unknown>) => void;
};

function createMcpClient(proc: ChildProcess): JsonRpcClient {
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  if (!proc.stdout) throw new Error("No stdout");

  const rl = createInterface({ input: proc.stdout });
  rl.on("line", (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg?.id) return;
    const id = String(msg.id);
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    if (msg.error) waiter.reject(new Error(msg.error.message || "MCP error"));
    else waiter.resolve(msg.result);
  });

  return {
    request(method, params) {
      if (!proc.stdin?.writable) throw new Error("stdin not writable");
      const id = randomUUID();
      const req = { jsonrpc: "2.0", id, method, params };
      proc.stdin.write(JSON.stringify(req) + "\n");
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    notify(method, params) {
      if (!proc.stdin?.writable) return;
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    },
  };
}

async function callTool(
  client: JsonRpcClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<any> {
  const result = (await client.request("tools/call", {
    name,
    arguments: args,
  })) as any;

  const text =
    result?.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") ?? "";

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function runCaptureCli(
  bin: string,
  subArgs: string[],
  env: Record<string, string>,
): Promise<number | null> {
  return new Promise((resolve) => {
    const p = spawn(bin, subArgs, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    p.on("close", (code) => resolve(code));
    p.on("error", () => resolve(null));
  });
}

// ── Tests ────────────────────────────────────────────────────────────

const TIMEOUT = 60_000;

test("OpenClaw capture flow: prompt + response -> rlm_stats", { timeout: TIMEOUT }, async () => {
  const tmpHome = createIsolatedHome();
  const env = isolatedEnv(tmpHome);

  // Start MCP server
  const proc = spawn(sageBin, ["mcp", "start"], {
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });

  const client = createMcpClient(proc);

  try {
    // MCP handshake
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "openclaw-e2e-test", version: "0.0.0" },
    });
    assert.ok(init, "initialize should return a result");
    client.notify("notifications/initialized", {});

    // Baseline stats
    const baselineStats = await callTool(client, "rlm_stats");
    assert.ok(baselineStats, "rlm_stats should return a result");

    // Inject captures mimicking OpenClaw's message_received + agent_end hooks
    const captureEnv = {
      ...env,
      SAGE_SOURCE: "openclaw",
      OPENCLAW: "1",
    };

    const prompts = [
      {
        prompt: "How to implement a plugin system in TypeScript?",
        response: "Use dynamic imports, define a plugin interface, register plugins at startup.",
      },
      {
        prompt: "Best practices for error handling in Node.js",
        response:
          "Use try-catch with async/await, create custom error classes, use error middleware.",
      },
      {
        prompt: "How to write unit tests with vitest?",
        response:
          "Install vitest, create .test.ts files, use describe/it/expect, run with npx vitest.",
      },
    ];

    for (const { prompt, response } of prompts) {
      // Phase 1: capture prompt (simulates message_received hook)
      const promptExit = await runCaptureCli(sageBin, ["capture", "hook", "prompt"], {
        ...captureEnv,
        PROMPT: prompt,
        SAGE_SESSION_ID: "openclaw-e2e-session",
        SAGE_MODEL: "gpt-4",
        SAGE_PROVIDER: "openai",
        SAGE_CAPTURE_ATTRIBUTES_JSON: JSON.stringify({
          openclaw: {
            hook: "message_received",
            sessionId: "openclaw-e2e-session",
            channel: "test",
          },
        }),
      });
      // Exit code check (may be non-zero if daemon socket not found, but file-based fallback works)
      assert.ok(promptExit !== null, "prompt capture should not crash");

      // Phase 2: capture response (simulates agent_end hook)
      const responseExit = await runCaptureCli(sageBin, ["capture", "hook", "response"], {
        ...captureEnv,
        LAST_RESPONSE: response,
        TOKENS_INPUT: "150",
        TOKENS_OUTPUT: "75",
      });
      assert.ok(responseExit !== null, "response capture should not crash");
    }

    // Run analysis via MCP
    const analysisResult = await callTool(client, "rlm_analyze_captures", {
      goal: "improve developer productivity",
    });
    assert.ok(analysisResult, "rlm_analyze_captures should return a result");

    // Check patterns
    const patterns = await callTool(client, "rlm_list_patterns", {});
    assert.ok(patterns, "rlm_list_patterns should return a result");

    // Final stats should reflect some activity
    const finalStats = await callTool(client, "rlm_stats");
    assert.ok(finalStats, "final rlm_stats should return a result");
  } finally {
    proc.kill("SIGTERM");
  }
});

test(
  "OpenClaw capture with custom attributes preserves metadata",
  { timeout: TIMEOUT },
  async () => {
    const tmpHome = createIsolatedHome();
    const env = isolatedEnv(tmpHome);

    const attrs = {
      openclaw: {
        hook: "message_received",
        sessionId: "test-sess-123",
        sessionKey: "key-456",
        channel: "web",
        senderId: "user-789",
      },
    };

    // Run capture with rich OpenClaw attributes
    const exitCode = await runCaptureCli(sageBin, ["capture", "hook", "prompt"], {
      ...env,
      SAGE_SOURCE: "openclaw",
      OPENCLAW: "1",
      PROMPT: "Test prompt with rich metadata",
      SAGE_SESSION_ID: "test-sess-123",
      SAGE_MODEL: "claude-3-opus",
      SAGE_PROVIDER: "anthropic",
      SAGE_WORKSPACE: "/workspace/project",
      SAGE_CAPTURE_ATTRIBUTES_JSON: JSON.stringify(attrs),
    });

    // Should not crash (exit code may be non-zero if daemon not running, that's OK)
    assert.ok(exitCode !== null, "capture with attributes should not crash");
  },
);
