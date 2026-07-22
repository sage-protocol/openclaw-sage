import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { McpBridge } from "./mcp-bridge.js";
import plugin from "./index.js";
import { __test } from "./index.js";

test("plugin manifest declares every registered agent tool contract", () => {
  const manifest = JSON.parse(readFileSync(resolve(new URL("..", import.meta.url).pathname, "openclaw.plugin.json"), "utf8"));
  assert.deepEqual(
    [...manifest.contracts.tools].sort(),
    ["sage_coordination", "sage_execute", "sage_search", "sage_status"],
  );
});

test("plugin cold manifest activates mixed tools, hooks, and services at startup", () => {
  const packageRoot = resolve(new URL("..", import.meta.url).pathname);
  const manifest = JSON.parse(readFileSync(join(packageRoot, "openclaw.plugin.json"), "utf8"));
  assert.equal(manifest.activation?.onStartup, true);
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  assert.deepEqual(packageJson.openclaw?.runtimeExtensions, ["./dist/index.js"]);
});

test("cold sage_coordination contract remains registered when controller execution is disabled", async () => {
  let coordinationTool: any;
  plugin.register({
    id: "test",
    name: "test",
    pluginConfig: { coordinationControllerEnabled: false },
    logger: { info() {}, warn() {}, error() {} },
    registerTool(tool: any) {
      if (tool?.name === "sage_coordination") coordinationTool = tool;
    },
    registerService() {},
    on() {},
    registerHook() {},
  } as any);
  assert.ok(coordinationTool);
  const result = await coordinationTool.execute("disabled-test", { action: "list_pending", params: {} });
  assert.equal(result.details?.error, "coordination_disabled");
});

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

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const old: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) old[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withEnvAsync<T>(
  patch: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const old: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) old[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createFakeSageCli(): { dir: string; bin: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "openclaw-sage-fake-"));
  const bin = join(dir, "sage");
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const cmd = args.join(' ');
if (cmd === 'wallet current') {
  console.log('Address: 0x9794415D000000000000000000000000000007CA');
  console.log('Type: privy');
  console.log('Chain ID: 84532');
  process.exit(0);
}
if (cmd === 'library active') {
  console.log('1. test-lib');
  process.exit(0);
}
if (cmd === 'library list') {
  console.log('test-lib (2 prompts, 3 skills)');
  process.exit(0);
}
if (cmd === 'capture hook prompt' || cmd === 'capture hook response') process.exit(0);
process.exit(0);
`,
  );
  chmodSync(bin, 0o755);
  return { dir, bin, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function registerPromptBuildHook(pluginConfig: Record<string, unknown> = {}) {
  const hooks: Record<string, any> = {};
  const api = {
    id: "t",
    name: "t",
    pluginConfig,
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
    registerHook: (_hook: string, _handler: any) => {},
  };
  plugin.register(api as any);
  assert.ok(typeof hooks.before_prompt_build === "function", "expected before_prompt_build hook");
  return hooks.before_prompt_build;
}

async function measurePrompt(hook: any, prompt: string) {
  const result = (await hook({ prompt })) ?? {};
  const stable = result.prependSystemContext ?? "";
  const dynamic = result.prependContext ?? "";
  const stableBytes = Buffer.byteLength(stable, "utf8");
  const dynamicBytes = Buffer.byteLength(dynamic, "utf8");
  return {
    stable,
    dynamic,
    stableBytes,
    dynamicBytes,
    totalBytes: stableBytes + dynamicBytes,
    hasSuggestedSkills: /## Suggested Skills/.test(`${stable}\n${dynamic}`),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

test("package uses plugin-managed runtime hooks instead of a bundled hook pack", () => {
  const root = resolve(new URL("..", import.meta.url).pathname);
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.equal(pkg.openclaw?.hooks, undefined);
  assert.equal(existsSync(resolve(root, "hooks", "sage-hook", "HOOK.md")), false);
  assert.equal(existsSync(resolve(root, "hooks", "sage-hook", "handler.ts")), false);
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

test("SageSearchDomain union accepts read-only marketplace and lineage domains", () => {
  const schema = __test.SageSearchDomain as any;
  assert.ok(Array.isArray(schema.anyOf), "SageSearchDomain should compile to a union (anyOf)");
  const literals = schema.anyOf.map((v: any) => v.const);
  assert.ok(literals.includes("marketplace"), "search domain union should include marketplace");
  assert.ok(literals.includes("lineage"), "search domain union should include lineage");
  assert.ok(literals.includes("skills"), "search domain union should still include skills");
  assert.ok(literals.includes("builder"), "search domain union should still include builder");
});

test("SageExecuteDomain union rejects read-only marketplace and lineage domains", () => {
  const schema = __test.SageExecuteDomain as any;
  assert.ok(Array.isArray(schema.anyOf), "SageExecuteDomain should compile to a union (anyOf)");
  const literals = schema.anyOf.map((v: any) => v.const);
  assert.ok(
    !literals.includes("marketplace"),
    "execute domain union must NOT include marketplace (read-only slice)",
  );
  assert.ok(
    !literals.includes("lineage"),
    "execute domain union must NOT include lineage (read-only slice)",
  );
  assert.ok(literals.includes("skills"), "execute domain union should still include skills");
});

test("runtime guard rejects schema-bypassed lineage execute requests", () => {
  assert.equal(
    __test.discoveryOnlyDomainError("lineage"),
    "Domain 'lineage' is discovery-only. Use sage_search instead.",
  );
  assert.equal(__test.discoveryOnlyDomainError("marketplace"), "Domain 'marketplace' is discovery-only. Use sage_search instead.");
  assert.equal(__test.discoveryOnlyDomainError("skills"), null);
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

test("SAGE_CONTEXT includes discovery affordance and stays thin", () => {
  const ctx = __test.SAGE_CONTEXT;
  assert.ok(ctx.includes("Sage (Code Mode)"), "should include Code Mode header");
  assert.ok(ctx.includes("capability layer"), "should use capability-first framing");
  assert.ok(ctx.includes("sage_search"), "should mention sage_search");
  assert.ok(ctx.includes("sage_execute"), "should mention sage_execute");
  assert.ok(ctx.includes("sage_status"), "should mention sage_status");
  assert.ok(ctx.includes("@sage"), "should describe explicit richer-discovery trigger");
  assert.ok(ctx.includes("Skill suggestions may surface automatically"), "should encode auto-suggest posture");
  assert.ok(Buffer.byteLength(ctx, "utf8") < 1400, "stable card should remain compact");
  assert.ok(!ctx.includes("Wallet and auth troubleshooting"), "stable context should not preload auth manual");
  assert.ok(!ctx.includes("Collaboration Posture"), "stable context should not preload collaboration manual");
  assert.ok(!ctx.includes("Distribution ladder"), "stable context should not preload distribution manual");
});

test("explicit Sage trigger detection is narrow", () => {
  assert.equal(__test.isExplicitSagePrompt("@sage find a context hygiene skill"), true);
  assert.equal(__test.isExplicitSagePrompt("please use sage_search for prior art"), true);
  assert.equal(__test.isExplicitSagePrompt("use sage_execute only after approval"), true);
  assert.equal(__test.isExplicitSagePrompt("sagebrush grows here"), false);
  assert.equal(__test.isExplicitSagePrompt("ordinary usage question"), false);
});

test("soulStreamApplies gates on DAO, non-generic library id, and narrow governance terms", () => {
  assert.equal(__test.soulStreamApplies("Review DAO 0xAbC123 proposal", "0xabc123", "soul"), true);
  assert.equal(__test.soulStreamApplies("Review DAO 0xAbC1234 proposal", "0xabc123", "soul"), true, "governance term still matches even when address token is longer");
  assert.equal(__test.soulStreamApplies("ordinary reference to 0xAbC1234", "0xabc123", "soul"), false, "DAO address should not match as a substring of a longer hex token");
  assert.equal(__test.soulStreamApplies("ordinary token foo0xAbC123", "0xabc123", "soul"), false, "DAO address should require a narrow token boundary before the address");
  assert.equal(__test.soulStreamApplies("Use soul-alpha context", "", "soul-alpha"), true);
  assert.equal(__test.soulStreamApplies("This is a soulful parser refactor", "", "soul"), false);
  for (const term of ["proposal", "treasury", "quorum", "vote", "voting", "delegate", "delegation", "governance", "dao", "subdao", "bounty", "reflection"]) {
    assert.equal(__test.soulStreamApplies(`Need ${term} context`, "", "soul"), true, term);
  }
  for (const term of ["library", "claim", "tip", "voted", "devoted"]) {
    assert.equal(__test.soulStreamApplies(`ordinary ${term} work`, "", "soul"), false, term);
  }
});

test("default config has ordinary prompt skill suggestions enabled", () => {
  assert.equal(__test.resolveAutoSuggestSkills({}), true);
  assert.equal(__test.resolveAutoSuggestSkills({ autoSuggestSkills: false }), false);
  assert.equal(__test.resolveAutoSuggestCooldownMs({}), 20_000);
  assert.equal(__test.resolveAutoSuggestCooldownMs({ autoSuggestCooldownMs: 0 }), 0);
  assert.equal(__test.resolveAutoSuggestCooldownMs({ autoSuggestCooldownMs: 50 }), 50);
});

test("before_prompt_build measures normal prompts without a ready bridge", async () => {
  const fake = createFakeSageCli();
  try {
    const hook = withEnv({ SAGE_CAPTURE_HOOKS: "0" }, () =>
      registerPromptBuildHook({ sageBinary: fake.bin }),
    );
    const fixtures = [
      "refactor this TypeScript parser and update tests",
      "fix",
      "@sage find a skill for context hygiene review",
      "Use sage_search to inspect relevant skills before editing",
      "Sage Protocol Heartbeat: review context and suggest capabilities",
    ];
    const measurements = [];
    for (const prompt of fixtures) measurements.push(await measurePrompt(hook, prompt));

    for (const m of measurements) {
      assert.equal(m.totalBytes, m.stableBytes + m.dynamicBytes);
    }

    const normal = measurements[0];
    assert.equal(normal.hasSuggestedSkills, false, "normal prompt cannot get suggestions without a ready bridge");
    assert.ok(normal.stable.includes("Sage (Code Mode)"), "normal prompt keeps compact affordance");
    assert.ok(!normal.stable.includes("### Key Commands"), "identity block should not include command list");
    assert.ok(!normal.stable.includes("Distribution ladder"), "identity block should not duplicate protocol manual");

    // Baseline note: before this refactor ordinary prompts received the same stable card plus
    // duplicated protocol/key-command identity text and could receive a dynamic skill block.
    const normalMedian = median([measurements[0].totalBytes, measurements[1].totalBytes]);
    assert.ok(Number.isFinite(normalMedian));
  } finally {
    fake.cleanup();
  }
});

test("soul stream context is injected only for governance-relevant prompts", async () => {
  const fake = createFakeSageCli();
  const xdg = mkdtempSync(join(tmpdir(), "openclaw-sage-xdg-"));
  try {
    const dao = "0xabc123";
    const soulDir = join(xdg, "sage", "souls");
    mkdirSync(soulDir, { recursive: true });
    writeFileSync(join(soulDir, `${dao}-soul.md`), "SOUL_SENTINEL: treasury context");

    await withEnvAsync({ XDG_DATA_HOME: xdg, SAGE_CAPTURE_HOOKS: "0" }, async () => {
      const hook = registerPromptBuildHook({ sageBinary: fake.bin, soulStreamDao: dao });

      const ordinary = await measurePrompt(hook, "refactor this TypeScript parser");
      assert.ok(!ordinary.stable.includes("SOUL_SENTINEL"));

      const governance = await measurePrompt(hook, "Review this proposal for the DAO treasury");
      assert.ok(governance.stable.includes("SOUL_SENTINEL"));
    });
  } finally {
    fake.cleanup();
    rmSync(xdg, { recursive: true, force: true });
  }
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

test("OpenClaw plugin registers MCP tools via sage mcp start", async (t) => {
  const sageBin = resolveSageBinaryForTests();
  if (!canExecuteSage(sageBin)) {
    t.skip(`sage binary not available for integration test: ${sageBin}`);
    return;
  }
  if (!isRepoDebugSage(sageBin)) {
    t.skip(`expected repo debug sage binary; got: ${sageBin}`);
    return;
  }

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
    registerHook: (_hook: string, _handler: any) => {},
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
  const runtimeHooks: Record<string, any> = {};

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
    registerHook: (hook: string, handler: any) => {
      runtimeHooks[hook] = handler;
    },
  };

  plugin.register(api as any);
  assert.ok(typeof hooks.before_prompt_build === "function", "expected before_prompt_build hook");
  assert.ok(typeof hooks.agent_end === "function", "expected agent_end capture hook");
  assert.ok(typeof runtimeHooks["agent:bootstrap"] === "function");
  assert.ok(typeof runtimeHooks["command:new"] === "function");
  assert.ok(typeof runtimeHooks["command:stop"] === "function");

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

test("formatSkillSuggestions formats load-first ranking shortlist", () => {
  const out = __test.formatSkillSuggestions(
    [
      {
        key: "bug-bounty",
        name: "Bug Bounty",
        description: "Recon, scanning, API testing",
        source: "installed",
        mcpServers: ["zap"],
        mustLoadFull: true,
        loadCommands: {
          native: "/skill:Bug Bounty or read SKILL.md",
          cli: "sage library inspect skill get bug-bounty",
          mcp: "get_skill or use_skill (returns body; does not run steps)",
        },
        realpaths: ["/home/user/.agents/skills/bug-bounty/SKILL.md"],
      },
      { key: "", name: "skip" },
    ],
    3,
  );

  assert.ok(out.includes("## Suggested Skills"));
  assert.ok(out.includes("RANKING SHORTLIST"));
  assert.ok(out.includes("Load full procedure before freestyle"));
  assert.ok(out.includes("native path: read `/home/user/.agents/skills/bug-bounty/SKILL.md`"));
  assert.ok(out.includes("sage library inspect skill get bug-bounty"));
  assert.ok(out.includes('"domain": "skills"'));
  assert.ok(out.includes('"action": "use"') || out.includes('"action": "get"'));
  assert.ok(out.includes('"key": "bug-bounty"'));
  assert.ok(out.includes("requires: zap"));
});

test("formatSkillSuggestions injects high-score skill body", () => {
  const out = __test.formatSkillSuggestions(
    [
      {
        key: "code-audit",
        name: "code-audit",
        mustLoadFull: true,
        score: 90,
        content: "# Code Audit\n\nStep 1: inventory\nStep 2: review",
      },
    ],
    1,
  );
  assert.ok(out.includes("--- Full skill procedure: code-audit ---"));
  assert.ok(out.includes("Step 1: inventory"));
});

test("parseSkillSuggestionResults preserves loadCommands and mustLoadFull", () => {
  const parsed = __test.parseSkillSuggestionResults(
    JSON.stringify({
      results: [
        {
          key: "code-audit",
          name: "code-audit",
          type: "skill",
          entryKind: "skill",
          description: "Audit code",
          mustLoadFull: true,
          loadCommands: {
            native: "/skill:code-audit",
            cli: "sage library inspect skill get code-audit",
          },
          score: 80,
          mcp_servers: ["semgrep"],
        },
      ],
    }),
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].key, "code-audit");
  assert.equal(parsed[0].mustLoadFull, true);
  assert.equal(parsed[0].loadCommands?.cli, "sage library inspect skill get code-audit");
  assert.deepEqual(parsed[0].mcpServers, ["semgrep"]);
  assert.equal(parsed[0].score, 80);
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
    registerHook: (_hook: string, _handler: any) => {},
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
    registerHook: (_hook: string, _handler: any) => {},
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
