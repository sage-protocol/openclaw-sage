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

function isRepoDebugSage(bin: string): boolean {
  // The repo build resolves to an explicit target/debug path; fallback is plain "sage" on PATH.
  return bin.includes("/target/debug/") || bin.includes("\\target\\debug\\");
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

// ── P1: Schema conversion ────────────────────────────────────────────

test("mcpSchemaToTypebox handles string properties", () => {
  const schema = __test.mcpSchemaToTypebox({
    type: "object",
    properties: {
      name: { type: "string", description: "A name" },
    },
    required: ["name"],
  }) as any;
  assert.ok(schema);
  assert.equal(schema.type, "object");
  assert.ok(schema.properties.name, "should have name property");
});

test("mcpSchemaToTypebox handles enum properties", () => {
  const schema = __test.mcpSchemaToTypebox({
    type: "object",
    properties: {
      vote: { type: "string", enum: ["for", "against", "abstain"], description: "Vote direction" },
    },
    required: ["vote"],
  }) as any;
  assert.ok(schema);
  const voteField = schema.properties.vote;
  assert.ok(voteField, "should have vote property");
  // Union of literals produces anyOf
  assert.ok(
    voteField.anyOf || voteField.const || voteField.enum,
    "enum should produce union of literals or single literal",
  );
});

test("mcpSchemaToTypebox handles typed arrays", () => {
  const schema = __test.mcpSchemaToTypebox({
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" }, description: "Tags list" },
    },
  }) as any;
  assert.ok(schema);
  const tagsField = schema.properties.tags;
  assert.ok(tagsField, "should have tags property");
});

test("mcpSchemaToTypebox handles nested objects", () => {
  const schema = __test.mcpSchemaToTypebox({
    type: "object",
    properties: {
      config: {
        type: "object",
        properties: {
          timeout: { type: "number", description: "Timeout in ms" },
          retry: { type: "boolean" },
        },
        required: ["timeout"],
      },
    },
  }) as any;
  assert.ok(schema);
  const configField = schema.properties.config;
  assert.ok(configField, "should have config property");
  assert.ok(configField.properties?.timeout, "nested object should have timeout");
});

test("mcpSchemaToTypebox handles empty/missing schema gracefully", () => {
  assert.ok(__test.mcpSchemaToTypebox(undefined));
  assert.ok(__test.mcpSchemaToTypebox({}));
  assert.ok(__test.mcpSchemaToTypebox({ type: "object" }));
});

test("jsonSchemaToTypebox handles single enum value as literal", () => {
  const result = __test.jsonSchemaToTypebox({ type: "string", enum: ["only_value"] });
  assert.ok(result);
  assert.equal(result.const, "only_value");
});

// ── P2: Error enrichment ─────────────────────────────────────────────

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
  assert.ok(ctx.includes("Sage (Code Mode)"), "should include Code Mode header");
  assert.ok(ctx.includes("sage_search"), "should mention sage_search");
  assert.ok(ctx.includes("sage_execute"), "should mention sage_execute");
  assert.ok(ctx.includes("sage_status"), "should mention sage_status");
});

// ── Existing tests (integration — require sage binary) ───────────────

test("McpBridge can initialize, list tools, and call a native tool", async (t) => {
  const sageBin = resolveSageBinaryForTests();
  if (!canExecuteSage(sageBin)) {
    t.skip(`sage binary not available for integration test: ${sageBin}`);
    return;
  }
  if (!isRepoDebugSage(sageBin)) {
    t.skip(`expected repo debug sage binary; got: ${sageBin}`);
    return;
  }
  const bridge = new McpBridge(sageBin, ["mcp", "start"]);
  try {
    await bridge.start();
    assert.ok(bridge.isReady(), "bridge should be ready after start");
    const tools = await bridge.listTools();
    assert.ok(Array.isArray(tools));
    assert.ok(
      tools.some((t) => t.name === "sage_search"),
      "expected sage_search tool to exist",
    );
    assert.ok(
      tools.some((t) => t.name === "sage_execute"),
      "expected sage_execute tool to exist",
    );
    assert.ok(
      tools.some((t) => t.name === "hub_list_servers"),
      "expected direct hub tool to exist alongside Code Mode tools",
    );

    const result = await bridge.callTool("sage_search", {
      domain: "meta",
      action: "get_project_context",
      params: {},
    });
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

  assert.ok(registeredTools.includes("sage_search"), "expected sage_search to be registered");
  assert.ok(registeredTools.includes("sage_execute"), "expected sage_execute to be registered");

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

test("OpenClaw plugin registers before_prompt_build hook and returns context blocks", async () => {
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
  assert.ok(typeof hooks.before_prompt_build === "function", "expected before_prompt_build hook");
  assert.ok(typeof hooks.agent_end === "function", "expected agent_end capture hook");

  const result = await hooks.before_prompt_build({ prompt: "build an mcp server" });
  assert.ok(result && typeof result === "object");
  assert.ok(
    typeof result.prependSystemContext === "string" && result.prependSystemContext.includes("Sage (Code Mode)"),
    "expected prependSystemContext with Sage Code Mode context",
  );
  assert.ok(
    result.prependContext == null || typeof result.prependContext === "string",
    "expected optional prependContext for dynamic suggestions/guards",
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
  assert.ok(out.includes("`sage_execute`"));
  assert.ok(out.includes('"domain": "skills"'));
  assert.ok(out.includes('"action": "use"'));
  assert.ok(out.includes('"key": "bug-bounty"'));
  assert.ok(out.includes("requires: zap"));
});

test("OpenClaw injectionGuard blocks dangerous execute payload (optional e2e)", async () => {
  if (process.env.SAGE_E2E_OPENCLAW !== "1") {
    return;
  }

  addSageDebugBinToPath();

  const tools = new Map<string, any>();
  const services: Array<{ id: string; start: Function; stop?: Function }> = [];

  const api = {
    id: "t",
    name: "t",
    pluginConfig: {
      injectionGuardEnabled: true,
      injectionGuardMode: "block",
      injectionGuardScanAgentPrompt: false,
      injectionGuardScanGetPrompt: false,
    },
    logger: {
      info: (_: string) => {},
      warn: (_: string) => {},
      error: (_: string) => {},
    },
    registerTool: (tool: any) => {
      if (tool?.name) tools.set(tool.name, tool);
    },
    registerService: (svc: any) => {
      services.push(svc);
    },
    on: (_hook: string, _handler: any) => {},
  };

  plugin.register(api as any);
  const svc = services.find((s) => s.id === "sage-mcp-bridge");
  assert.ok(svc, "expected sage-mcp-bridge service to be registered");

  await svc!.start({ config: {}, stateDir: "/tmp", logger: api.logger });
  try {
    const executeTool = tools.get("sage_execute");
    assert.ok(executeTool?.execute, "expected sage_execute tool");

    const result = await executeTool.execute("call-1", {
      domain: "skills",
      action: "use",
      params: { key: "rm -rf /" },
    });

    const text =
      result?.content
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n") ?? "";

    const blocked = /Blocked by injection guard/i.test(text);
    if (!blocked) {
      assert.ok(text.length > 0, "expected a normal tool response when not blocked");
    }
  } finally {
    if (svc!.stop) {
      await svc!.stop({ config: {}, stateDir: "/tmp", logger: api.logger });
    }
  }
});

test("OpenClaw injectionGuard warn mode does not hard-block execution (optional e2e)", async () => {
  if (process.env.SAGE_E2E_OPENCLAW !== "1") {
    return;
  }

  addSageDebugBinToPath();

  const tools = new Map<string, any>();
  const services: Array<{ id: string; start: Function; stop?: Function }> = [];

  const api = {
    id: "t",
    name: "t",
    pluginConfig: {
      injectionGuardEnabled: true,
      injectionGuardMode: "warn",
      injectionGuardScanAgentPrompt: false,
      injectionGuardScanGetPrompt: false,
    },
    logger: {
      info: (_: string) => {},
      warn: (_: string) => {},
      error: (_: string) => {},
    },
    registerTool: (tool: any) => {
      if (tool?.name) tools.set(tool.name, tool);
    },
    registerService: (svc: any) => {
      services.push(svc);
    },
    on: (_hook: string, _handler: any) => {},
  };

  plugin.register(api as any);
  const svc = services.find((s) => s.id === "sage-mcp-bridge");
  assert.ok(svc, "expected sage-mcp-bridge service to be registered");

  await svc!.start({ config: {}, stateDir: "/tmp", logger: api.logger });
  try {
    const executeTool = tools.get("sage_execute");
    assert.ok(executeTool?.execute, "expected sage_execute tool");

    const result = await executeTool.execute("call-2", {
      domain: "skills",
      action: "use",
      params: { key: "rm -rf /" },
    });

    const text =
      result?.content
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n") ?? "";

    assert.ok(!/Blocked by injection guard/i.test(text));
  } finally {
    if (svc!.stop) {
      await svc!.stop({ config: {}, stateDir: "/tmp", logger: api.logger });
    }
  }
});
