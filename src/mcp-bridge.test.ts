import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { McpBridge } from "./mcp-bridge.js";
import plugin from "./index.js";
import { __test } from "./index.js";

function candidateSageDebugBinDirs(): string[] {
  const here = resolve(new URL("..", import.meta.url).pathname);
  const candidates = [
    // Monorepo layout: packages/openclaw-sage and packages/sage
    resolve(here, "..", "sage", "target", "debug"),
    // Legacy layout fallback
    resolve(here, "..", "target", "debug"),
  ];
  return [...new Set(candidates.filter((dir) => existsSync(dir)))];
}

function resolveSageBinaryForTests(): string {
  const override = process.env.SAGE_BIN_TEST || process.env.SAGE_BIN;
  if (override && override.trim()) return override.trim();

  const exe = process.platform === "win32" ? "sage.exe" : "sage";
  for (const dir of candidateSageDebugBinDirs()) {
    const candidate = resolve(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  // Fallback to PATH
  return "sage";
}

function canExecuteSage(bin: string): boolean {
  const probe = spawnSync(bin, ["--version"], { stdio: "ignore" });
  return probe.status === 0;
}

function addSageDebugBinToPath() {
  // Ensure the `sage` binary used by the plugin resolves to this repo's build first.
  const dirs = candidateSageDebugBinDirs();
  if (!dirs.length) return { binDir: undefined };
  const sep = process.platform === "win32" ? ";" : ":";
  process.env.PATH = `${dirs.join(sep)}${sep}${process.env.PATH ?? ""}`;
  return { binDir: dirs[0] };
}

// ── P0: Version consistency ──────────────────────────────────────────

test("PKG_VERSION matches package.json version", () => {
  const pkgPath = resolve(new URL("..", import.meta.url).pathname, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  assert.equal(__test.PKG_VERSION, pkg.version, "PKG_VERSION should match package.json");
});

test("plugin.version matches package.json version", () => {
  const pkgPath = resolve(new URL("..", import.meta.url).pathname, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  assert.equal(plugin.version, pkg.version, "plugin.version should match package.json");
});

// ── P1: Error enrichment ─────────────────────────────────────────────

test("enrichErrorMessage adds wallet hint for wallet errors", () => {
  const err = new Error("No wallet connected");
  const enriched = __test.enrichErrorMessage(err, "list_proposals");
  assert.ok(enriched.includes("sage wallet connect"), "should suggest wallet connect");
});

test("enrichErrorMessage adds auth hint for auth errors", () => {
  const err = new Error("401 Unauthorized: token expired");
  const enriched = __test.enrichErrorMessage(err, "ipfs_upload");
  assert.ok(enriched.includes("sage config ipfs setup"), "should suggest config ipfs setup");
});

test("enrichErrorMessage adds network hint for RPC errors", () => {
  const err = new Error("ECONNREFUSED 127.0.0.1:8545");
  const enriched = __test.enrichErrorMessage(err, "list_subdaos");
  assert.ok(enriched.includes("SAGE_PROFILE"), "should mention SAGE_PROFILE");
});

test("enrichErrorMessage adds bridge hint for bridge errors", () => {
  const err = new Error("MCP bridge not running");
  const enriched = __test.enrichErrorMessage(err, "search_prompts");
  assert.ok(enriched.includes("sage mcp start"), "should suggest mcp start");
});

test("enrichErrorMessage adds credits hint for balance errors", () => {
  const err = new Error("Insufficient IPFS balance");
  const enriched = __test.enrichErrorMessage(err, "ipfs_pin");
  assert.ok(enriched.includes("sage config ipfs faucet"), "should suggest config ipfs faucet");
});

test("enrichErrorMessage passes through unknown errors", () => {
  const err = new Error("Something unexpected");
  const enriched = __test.enrichErrorMessage(err, "unknown_tool");
  assert.equal(enriched, "Something unexpected");
});

// ── P2: SAGE_CONTEXT completeness ────────────────────────────────────

test("SAGE_CONTEXT includes all major tool categories", () => {
  const ctx = __test.SAGE_CONTEXT;
  assert.ok(ctx.includes("Governance & DAOs"), "should include Governance");
  assert.ok(ctx.includes("Tips, Bounties"), "should include Tips/Bounties");
  assert.ok(ctx.includes("Chat & Social"), "should include Chat");
  assert.ok(ctx.includes("RLM"), "should include RLM");
  assert.ok(ctx.includes("Memory"), "should include Memory");
  assert.ok(ctx.includes("sage_status"), "should include status tool");
});

// ── Existing tests (integration — require sage binary) ───────────────

test("McpBridge can initialize, list tools, and call a native tool", async (t) => {
  const sageBin = resolveSageBinaryForTests();
  if (!canExecuteSage(sageBin)) {
    t.skip(`sage binary not available for integration test: ${sageBin}`);
    return;
  }
  const bridge = new McpBridge(sageBin, ["mcp", "start"]);
  try {
    await bridge.start();
    assert.ok(bridge.isReady(), "bridge should be ready after start");
    const tools = await bridge.listTools();
    assert.ok(Array.isArray(tools));
    assert.ok(tools.length > 0);

    const hasProjectContext = tools.some((t) => t.name === "get_project_context");
    assert.ok(hasProjectContext, "expected get_project_context tool to exist");

    const result = await bridge.callTool("get_project_context", {});
    assert.ok(result && typeof result === "object");
  } finally {
    await bridge.stop().catch(() => {});
    assert.ok(!bridge.isReady(), "bridge should not be ready after stop");
  }
});

test("OpenClaw plugin registers MCP tools via sage mcp start", async () => {
  addSageDebugBinToPath();

  const registeredTools: string[] = [];
  const services: Array<{ id: string; start: Function; stop?: Function }> = [];

  const api = {
    id: "t",
    name: "t",
    logger: {
      info: (_: string) => {},
      warn: (_: string) => {},
      error: (_: string) => {},
    },
    registerTool: (tool: any) => {
      if (tool?.name) registeredTools.push(tool.name);
    },
    registerService: (svc: any) => {
      services.push(svc);
    },
    on: (_hook: string, _handler: any) => {},
  };

  plugin.register(api);
  const svc = services.find((s) => s.id === "sage-mcp-bridge");
  assert.ok(svc, "expected sage-mcp-bridge service to be registered");

  await svc!.start({
    config: {},
    stateDir: "/tmp",
    logger: api.logger,
  });

  // Tool names are prefixed with `sage_` in this plugin.
  assert.ok(
    registeredTools.some((n) => n.startsWith("sage_")),
    "expected at least one sage_* tool",
  );
  assert.ok(
    !registeredTools.some((n) => n.startsWith("sage_sage_")),
    "did not expect double-prefixed sage_sage_* tool names",
  );

  // sage_status meta-tool should be registered
  assert.ok(
    registeredTools.includes("sage_status"),
    "expected sage_status meta-tool to be registered",
  );

  if (svc!.stop) {
    await svc!.stop({
      config: {},
      stateDir: "/tmp",
      logger: api.logger,
    });
  }
});

test("OpenClaw plugin registers before_agent_start hook and returns prependContext", async () => {
  const hooks: Record<string, any> = {};

  const api = {
    id: "t",
    name: "t",
    pluginConfig: {},
    logger: {
      info: (_: string) => {},
      warn: (_: string) => {},
      error: (_: string) => {},
    },
    registerTool: (_tool: any) => {},
    registerService: (_svc: any) => {},
    on: (hook: string, handler: any) => {
      hooks[hook] = handler;
    },
  };

  plugin.register(api as any);
  assert.ok(typeof hooks.before_agent_start === "function", "expected before_agent_start hook");
  assert.ok(
    typeof hooks.after_agent_response === "function" || typeof hooks.agent_end === "function",
    "expected a response capture hook (after_agent_response or agent_end)",
  );

  const result = await hooks.before_agent_start({ prompt: "build an mcp server" });
  assert.ok(result && typeof result === "object");
  assert.ok(
    typeof result.prependContext === "string" && result.prependContext.includes("Sage MCP Tools Available"),
    "expected prependContext with Sage tool context",
  );
});

test("formatSkillSuggestions formats stable markdown", () => {
  const out = __test.formatSkillSuggestions(
    [
      {
        key: "bug-bounty",
        name: "Bug Bounty",
        description: "Recon, scanning, API testing",
        source: "installed",
        mcpServers: ["zap"],
      },
      { key: "", name: "skip" },
    ],
    3,
  );

  assert.ok(out.includes("## Suggested Skills"));
  assert.ok(out.includes("`use_skill` `bug-bounty`"));
  assert.ok(out.includes("requires: zap"));
});
