import { Type } from "@sinclair/typebox";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import TOML from "@iarna/toml";

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

/** Custom server configuration from mcp-servers.toml */
type CustomServerConfig = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  source: {
    type: "npx" | "node" | "binary";
    package?: string;
    path?: string;
  };
  extra_args?: string[];
  env?: Record<string, string>;
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

/**
 * Load custom server configurations from ~/.config/sage/mcp-servers.toml
 */
function loadCustomServers(): CustomServerConfig[] {
  const configPath = join(homedir(), ".config", "sage", "mcp-servers.toml");

  if (!existsSync(configPath)) {
    return [];
  }

  try {
    const content = readFileSync(configPath, "utf8");
    const config = TOML.parse(content) as {
      custom?: Record<string, {
        id: string;
        name: string;
        description?: string;
        enabled: boolean;
        source: { type: string; package?: string; path?: string };
        extra_args?: string[];
        env?: Record<string, string>;
      }>;
    };

    if (!config.custom) {
      return [];
    }

    return Object.values(config.custom)
      .filter((s) => s.enabled)
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        enabled: s.enabled,
        source: {
          type: s.source.type as "npx" | "node" | "binary",
          package: s.source.package,
          path: s.source.path,
        },
        extra_args: s.extra_args,
        env: s.env,
      }));
  } catch (err) {
    console.error(`Failed to parse mcp-servers.toml: ${err}`);
    return [];
  }
}

/**
 * Create command and args for spawning an external server
 */
function getServerCommand(server: CustomServerConfig): { command: string; args: string[] } {
  switch (server.source.type) {
    case "npx":
      return {
        command: "npx",
        args: ["-y", server.source.package!, ...(server.extra_args || [])],
      };
    case "node":
      return {
        command: "node",
        args: [server.source.path!, ...(server.extra_args || [])],
      };
    case "binary":
      return {
        command: server.source.path!,
        args: server.extra_args || [],
      };
    default:
      throw new Error(`Unknown source type: ${server.source.type}`);
  }
}

// ── Plugin Definition ────────────────────────────────────────────────────────

let sageBridge: McpBridge | null = null;
const externalBridges: Map<string, McpBridge> = new Map();

const plugin = {
  id: "openclaw-sage",
  name: "Sage Protocol",
  version: "0.2.0",
  description:
    "Sage MCP tools for prompt libraries, skills, governance, and on-chain operations (including external servers)",

  register(api: PluginApi) {
    // Main sage MCP bridge - pass HOME to ensure auth state is found
    sageBridge = new McpBridge("sage", ["mcp", "start"], {
      HOME: homedir(),
      PATH: process.env.PATH || "",
      USER: process.env.USER || "",
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      XDG_DATA_HOME: process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
    });
    sageBridge.on("log", (line: string) => api.logger.info(`[sage-mcp] ${line}`));
    sageBridge.on("error", (err: Error) => api.logger.error(`[sage-mcp] ${err.message}`));

    api.registerService({
      id: "sage-mcp-bridge",
      start: async (ctx) => {
        ctx.logger.info("Starting Sage MCP bridge...");

        // Start the main sage bridge
        try {
          await sageBridge!.start();
          ctx.logger.info("Sage MCP bridge ready");

          const tools = await sageBridge!.listTools();
          ctx.logger.info(`Discovered ${tools.length} internal MCP tools`);

          for (const tool of tools) {
            registerMcpTool(api, "sage", sageBridge!, tool);
          }
        } catch (err) {
          ctx.logger.error(
            `Failed to start sage MCP bridge: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        // Load and start external servers
        const customServers = loadCustomServers();
        ctx.logger.info(`Found ${customServers.length} custom external servers`);

        for (const server of customServers) {
          try {
            ctx.logger.info(`Starting external server: ${server.name} (${server.id})`);

            const { command, args } = getServerCommand(server);
            const bridge = new McpBridge(command, args, server.env);

            bridge.on("log", (line: string) => ctx.logger.info(`[${server.id}] ${line}`));
            bridge.on("error", (err: Error) => ctx.logger.error(`[${server.id}] ${err.message}`));

            await bridge.start();
            externalBridges.set(server.id, bridge);

            const tools = await bridge.listTools();
            ctx.logger.info(`[${server.id}] Discovered ${tools.length} tools`);

            for (const tool of tools) {
              registerMcpTool(api, server.id.replace(/-/g, "_"), bridge, tool);
            }
          } catch (err) {
            ctx.logger.error(
              `Failed to start ${server.name}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      },
      stop: async (ctx) => {
        ctx.logger.info("Stopping Sage MCP bridges...");

        // Stop external bridges
        for (const [id, bridge] of externalBridges) {
          ctx.logger.info(`Stopping ${id}...`);
          await bridge.stop();
        }
        externalBridges.clear();

        // Stop main sage bridge
        await sageBridge?.stop();
      },
    });
  },
};

function registerMcpTool(api: PluginApi, prefix: string, bridge: McpBridge, tool: McpToolDef) {
  const name = `${prefix}_${tool.name}`;
  const schema = mcpSchemaToTypebox(tool.inputSchema);

  api.registerTool(
    {
      name,
      label: `${prefix}: ${tool.name}`,
      description: tool.description ?? `MCP tool: ${prefix}/${tool.name}`,
      parameters: schema,
      execute: async (_toolCallId: string, params: Record<string, unknown>) => {
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
