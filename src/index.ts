import { Type } from "@sinclair/typebox";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import TOML from "@iarna/toml";

import { McpBridge, type McpToolDef } from "./mcp-bridge.js";

const SAGE_CONTEXT = `## Sage MCP Tools Available

You have access to Sage MCP tools for prompts, skills, and knowledge discovery.

### Prompt Discovery
- \`search_prompts\` - Hybrid keyword + semantic search for prompts
- \`list_prompts\` - Browse prompts by source (local/onchain)
- \`get_prompt\` - Get full prompt content by key
- \`builder_recommend\` - AI-powered prompt suggestions based on intent

### Skills
- \`search_skills\` / \`list_skills\` - Find available skills
- \`get_skill\` - Get skill details and content
- \`use_skill\` - Activate a skill (auto-provisions required MCP servers)

### External Tools (via Hub)
- \`hub_list_servers\` - List available MCP servers (memory, github, brave, etc.)
- \`hub_start_server\` - Start an MCP server to gain access to its tools
- \`hub_status\` - Check which servers are currently running

### Best Practices
1. **Search before implementing** - Use \`search_prompts\` or \`builder_recommend\` to find existing solutions
2. **Use skills for complex tasks** - Skills bundle prompts + MCP servers for specific workflows
3. **Start additional servers as needed** - Use \`hub_start_server\` for memory, github, brave search, etc.
4. **Check skill requirements** - Skills may require specific MCP servers; \`use_skill\` auto-provisions them`;

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
  pluginConfig?: Record<string, unknown>;
  registerTool: (tool: unknown, opts?: { name?: string; optional?: boolean }) => void;
  registerService: (service: {
    id: string;
    start: (ctx: PluginServiceContext) => void | Promise<void>;
    stop?: (ctx: PluginServiceContext) => void | Promise<void>;
  }) => void;
  on: (hook: string, handler: (...args: unknown[]) => unknown | Promise<unknown>) => void;
};

function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = typeof raw === "string" && raw.trim() ? Number(raw) : Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function truncateUtf8(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;

  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(s.slice(0, mid), "utf8") <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo);
}

function normalizePrompt(prompt: string, opts?: { maxBytes?: number }): string {
  const trimmed = prompt.trim();
  if (!trimmed) return "";
  const maxBytes = clampInt(opts?.maxBytes, 16_384, 512, 65_536);
  return truncateUtf8(trimmed, maxBytes);
}

function extractJsonFromMcpResult(result: unknown): unknown {
  const anyResult = result as any;
  if (!anyResult || typeof anyResult !== "object") return undefined;

  // Sage MCP tools typically return { content: [{ type: 'text', text: '...json...' }], isError?: bool }
  const text =
    Array.isArray(anyResult.content) && anyResult.content.length
      ? anyResult.content
          .map((c: any) => (c && typeof c.text === "string" ? c.text : ""))
          .filter(Boolean)
          .join("\n")
      : undefined;

  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

type SkillSearchResult = {
  key?: string;
  name?: string;
  description?: string;
  source?: string;
  library?: string;
  mcpServers?: string[];
};

function formatSkillSuggestions(results: SkillSearchResult[], limit: number): string {
  const items = results
    .filter((r) => r && typeof r.key === "string" && r.key.trim())
    .slice(0, limit);
  if (!items.length) return "";

  const lines: string[] = [];
  lines.push("## Suggested Skills");
  lines.push("");
  for (const r of items) {
    const key = r.key!.trim();
    const desc = typeof r.description === "string" ? r.description.trim() : "";
    const origin = typeof r.library === "string" && r.library.trim() ? ` (from ${r.library.trim()})` : "";
    const servers = Array.isArray(r.mcpServers) && r.mcpServers.length ? ` — requires: ${r.mcpServers.join(", ")}` : "";
    lines.push(`- \`use_skill\` \`${key}\`${origin}${desc ? `: ${desc}` : ""}${servers}`);
  }
  return lines.join("\n");
}

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
    const pluginCfg = api.pluginConfig ?? {};
    const sageBinary = typeof pluginCfg.sageBinary === "string" && pluginCfg.sageBinary.trim()
      ? pluginCfg.sageBinary.trim()
      : "sage";

    const autoInject = pluginCfg.autoInjectContext !== false;
    const autoSuggest = pluginCfg.autoSuggestSkills !== false;
    const suggestLimit = clampInt(pluginCfg.suggestLimit, 3, 1, 10);
    const minPromptLen = clampInt(pluginCfg.minPromptLen, 12, 0, 500);
    const maxPromptBytes = clampInt(pluginCfg.maxPromptBytes, 16_384, 512, 65_536);

    // Main sage MCP bridge - pass HOME to ensure auth state is found
    sageBridge = new McpBridge(sageBinary, ["mcp", "start"], {
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

    // Auto-inject context and suggestions at agent start.
    // This uses OpenClaw's plugin hook API (not internal hooks).
    api.on("before_agent_start", async (event: any) => {
      const prompt = normalizePrompt(typeof event?.prompt === "string" ? event.prompt : "", {
        maxBytes: maxPromptBytes,
      });
      if (!prompt || prompt.length < minPromptLen) {
        return autoInject ? { prependContext: SAGE_CONTEXT } : undefined;
      }

      let suggestBlock = "";
      if (autoSuggest && sageBridge) {
        try {
          const raw = await sageBridge.callTool("search_skills", {
            query: prompt,
            source: "all",
            limit: Math.max(20, suggestLimit),
          });
          const json = extractJsonFromMcpResult(raw) as any;
          const results = Array.isArray(json?.results) ? (json.results as SkillSearchResult[]) : [];
          suggestBlock = formatSkillSuggestions(results, suggestLimit);
        } catch {
          // Ignore suggestion failures; context injection should still work.
        }
      }

      const parts: string[] = [];
      if (autoInject) parts.push(SAGE_CONTEXT);
      if (suggestBlock) parts.push(suggestBlock);

      if (!parts.length) return undefined;
      return { prependContext: parts.join("\n\n") };
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

export const __test = {
  SAGE_CONTEXT,
  normalizePrompt,
  extractJsonFromMcpResult,
  formatSkillSuggestions,
};
