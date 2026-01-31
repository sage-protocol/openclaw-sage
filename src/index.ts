import { Type } from "@sinclair/typebox";

import { McpBridge, type McpToolDef } from "./mcp-bridge.js";

/**
 * Minimal type stubs for OpenClaw plugin API.
 *
 * OpenClaw's jiti runtime resolves "openclaw/plugin-sdk" at load time.
 * These stubs keep the code compilable standalone.
 */
type PluginLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

type PluginServiceContext = {
  config: unknown;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
};

type PluginApi = {
  id: string;
  name: string;
  logger: PluginLogger;
  registerTool: (tool: unknown, opts?: { name?: string; optional?: boolean }) => void;
  registerService: (service: {
    id: string;
    start: (ctx: PluginServiceContext) => void | Promise<void>;
    stop?: (ctx: PluginServiceContext) => void | Promise<void>;
  }) => void;
  on: (hook: string, handler: (...args: unknown[]) => void | Promise<void>) => void;
};

/**
 * Convert an MCP JSON Schema inputSchema into a TypeBox object schema
 * that OpenClaw's tool system accepts.
 */
function mcpSchemaToTypebox(inputSchema?: Record<string, unknown>) {
  if (!inputSchema || typeof inputSchema !== "object") {
    return Type.Object({});
  }

  const properties = (inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set(
    Array.isArray(inputSchema.required) ? (inputSchema.required as string[]) : [],
  );

  const fields: Record<string, unknown> = {};

  for (const [key, prop] of Object.entries(properties)) {
    const desc = typeof prop.description === "string" ? prop.description : undefined;
    const opts = desc ? { description: desc } : {};

    let field: unknown;
    switch (prop.type) {
      case "number":
      case "integer":
        field = Type.Number(opts);
        break;
      case "boolean":
        field = Type.Boolean(opts);
        break;
      case "array":
        field = Type.Array(Type.Unknown(), opts);
        break;
      case "object":
        field = Type.Record(Type.String(), Type.Unknown(), opts);
        break;
      default:
        field = Type.String(opts);
    }

    fields[key] = required.has(key) ? field : Type.Optional(field as any);
  }

  return Type.Object(fields as any, { additionalProperties: true });
}

function toToolResult(mcpResult: unknown) {
  const result = mcpResult as {
    content?: Array<{ type: string; text?: string }>;
  } | null;

  const text =
    result?.content
      ?.map((c) => c.text ?? "")
      .filter(Boolean)
      .join("\n") ?? JSON.stringify(mcpResult ?? {});

  return {
    content: [{ type: "text" as const, text }],
    details: mcpResult,
  };
}

// ── Plugin Definition ────────────────────────────────────────────────────────

let bridge: McpBridge | null = null;

const plugin = {
  id: "openclaw-sage",
  name: "Sage Protocol",
  version: "0.1.2",
  description:
    "Sage MCP tools for prompt libraries, skills, governance, and on-chain operations",

  register(api: PluginApi) {
    bridge = new McpBridge("sage", ["mcp", "start"]);

    bridge.on("log", (line: string) => api.logger.info(`[sage-mcp] ${line}`));
    bridge.on("error", (err: Error) => api.logger.error(`[sage-mcp] ${err.message}`));

    api.registerService({
      id: "sage-mcp-bridge",
      start: async (ctx) => {
        ctx.logger.info("Starting Sage MCP bridge...");
        try {
          await bridge!.start();
          ctx.logger.info("Sage MCP bridge ready");

          const tools = await bridge!.listTools();
          ctx.logger.info(`Discovered ${tools.length} MCP tools`);

          for (const tool of tools) {
            registerMcpTool(api, tool);
          }
        } catch (err) {
          ctx.logger.error(
            `Failed to start MCP bridge: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
      stop: async (ctx) => {
        ctx.logger.info("Stopping Sage MCP bridge...");
        await bridge?.stop();
      },
    });
  },
};

function registerMcpTool(api: PluginApi, tool: McpToolDef) {
  const name = `sage_${tool.name}`;
  const schema = mcpSchemaToTypebox(tool.inputSchema);

  api.registerTool(
    {
      name,
      label: `Sage: ${tool.name}`,
      description: tool.description ?? `Sage MCP tool: ${tool.name}`,
      parameters: schema,
      execute: async (_toolCallId: string, params: Record<string, unknown>) => {
        if (!bridge) {
          return toToolResult({ error: "MCP bridge not initialized" });
        }
        try {
          const result = await bridge.callTool(tool.name, params);
          return toToolResult(result);
        } catch (err) {
          return toToolResult({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    { name, optional: true },
  );
}

export default plugin;
