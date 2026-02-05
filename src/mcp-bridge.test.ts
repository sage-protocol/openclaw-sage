import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

import { McpBridge } from "./mcp-bridge.js";
import plugin from "./index.js";
import { __test } from "./index.js";

function addSageDebugBinToPath() {
  // Ensure the `sage` binary used by the plugin resolves to this repo's build.
  const binDir = resolve(new URL("..", import.meta.url).pathname, "..", "target", "debug");
  const sep = process.platform === "win32" ? ";" : ":";
  process.env.PATH = `${binDir}${sep}${process.env.PATH ?? ""}`;
  return { binDir };
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
  assert.ok(voteField.anyOf || voteField.const || voteField.enum,
    "enum should produce union of literals or single literal");
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
  assert.ok(enriched.includes("sage ipfs setup"), "should suggest ipfs setup");
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
  assert.ok(enriched.includes("sage ipfs faucet"), "should suggest faucet");
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

test("McpBridge can initialize, list tools, and call a native tool", async () => {
  const sageBin = resolve(new URL("..", import.meta.url).pathname, "..", "target", "debug", "sage");
  const bridge = new McpBridge(sageBin, ["mcp", "start"]);
  await bridge.start();
  try {
    assert.ok(bridge.isReady(), "bridge should be ready after start");
    const tools = await bridge.listTools();
    assert.ok(Array.isArray(tools));
    assert.ok(tools.length > 0);

    const hasProjectContext = tools.some((t) => t.name === "get_project_context");
    assert.ok(hasProjectContext, "expected get_project_context tool to exist");

    const result = await bridge.callTool("get_project_context", {});
    assert.ok(result && typeof result === "object");
  } finally {
    await bridge.stop();
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
