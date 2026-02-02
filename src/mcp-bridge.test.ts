import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { McpBridge } from "./mcp-bridge.js";
import plugin from "./index.js";

function addSageDebugBinToPath() {
  // Ensure the `sage` binary used by the plugin resolves to this repo's build.
  const binDir = resolve(new URL("..", import.meta.url).pathname, "..", "target", "debug");
  const sep = process.platform === "win32" ? ";" : ":";
  process.env.PATH = `${binDir}${sep}${process.env.PATH ?? ""}`;
  return { binDir };
}

test("McpBridge can initialize, list tools, and call a native tool", async () => {
  const sageBin = resolve(new URL("..", import.meta.url).pathname, "..", "target", "debug", "sage");
  const bridge = new McpBridge(sageBin, ["mcp", "start"]);
  await bridge.start();
  try {
    const tools = await bridge.listTools();
    assert.ok(Array.isArray(tools));
    assert.ok(tools.length > 0);

    const hasProjectContext = tools.some((t) => t.name === "get_project_context");
    assert.ok(hasProjectContext, "expected get_project_context tool to exist");

    const result = await bridge.callTool("get_project_context", {});
    assert.ok(result && typeof result === "object");
  } finally {
    await bridge.stop();
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

  if (svc!.stop) {
    await svc!.stop({
      config: {},
      stateDir: "/tmp",
      logger: api.logger,
    });
  }
});
