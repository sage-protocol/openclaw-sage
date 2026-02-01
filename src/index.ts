import { Type } from "@sinclair/typebox";

import { spawn } from "node:child_process";

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

function extractText(input: unknown): string {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return "";

  const obj = input as any;
  const direct = [obj.text, obj.content, obj.prompt, obj.message, obj.input];
  for (const c of direct) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  if (obj.message && typeof obj.message === "object") {
    const msg = obj.message as any;
    if (typeof msg.text === "string" && msg.text.trim()) return msg.text.trim();
    if (typeof msg.content === "string" && msg.content.trim()) return msg.content.trim();
  }

  // Transcript-style: [{role, content}]
  if (Array.isArray(obj.messages)) {
    for (let i = obj.messages.length - 1; i >= 0; i--) {
      const m = obj.messages[i];
      if (!m || typeof m !== "object") continue;
      const mm = m as any;
      if (typeof mm.content === "string" && mm.content.trim()) return mm.content.trim();
      if (typeof mm.text === "string" && mm.text.trim()) return mm.text.trim();
      if (Array.isArray(mm.content)) {
        const text = mm.content
          .map((b: any) => (b?.type === "text" ? b?.text : ""))
          .filter(Boolean)
          .join("\n");
        if (text.trim()) return text.trim();
      }
    }
  }

  return "";
}

function lastAssistantText(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as any;

  const candidates = [obj.final, obj.output, obj.result, obj.response];
  for (const c of candidates) {
    const t = extractText(c);
    if (t) return t;
  }

  if (Array.isArray(obj.messages)) {
    for (let i = obj.messages.length - 1; i >= 0; i--) {
      const m = obj.messages[i];
      if (!m || typeof m !== "object") continue;
      const mm = m as any;
      if (mm.role === "assistant") {
        const t = extractText(mm);
        if (t) return t;
      }
    }
  }

  return "";
}

function toStringOrEmpty(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return "";
}

function fireAndForget(cmd: string, args: string[], env: Record<string, string>): void {
  try {
    const p = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: "ignore",
      detached: true,
    });
    p.unref();
  } catch {
    // ignore
  }
}

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

    // RLM capture hooks (derived data): attach prompt/response pairs with OpenClaw tags.
    api.on("message_received", async (evt: unknown) => {
      const prompt = extractText(evt);
      if (!prompt) return;

      const e = evt as any;
      const sessionId =
        toStringOrEmpty(e?.sessionId) ||
        toStringOrEmpty(e?.sessionKey) ||
        toStringOrEmpty(e?.context?.sessionId) ||
        toStringOrEmpty(e?.context?.sessionKey);
      const workspaceDir = toStringOrEmpty(e?.workspaceDir) || toStringOrEmpty(e?.context?.workspaceDir);

      const attrs = {
        openclaw: {
          hook: "message_received",
          sessionId: toStringOrEmpty(e?.sessionId) || toStringOrEmpty(e?.context?.sessionId),
          sessionKey: toStringOrEmpty(e?.sessionKey) || toStringOrEmpty(e?.context?.sessionKey),
          channel: toStringOrEmpty(e?.channel) || toStringOrEmpty(e?.context?.commandSource),
          senderId: toStringOrEmpty(e?.senderId) || toStringOrEmpty(e?.context?.senderId),
        },
      };

      fireAndForget("sage", ["capture", "hook", "prompt"], {
        SAGE_SOURCE: "openclaw",
        OPENCLAW: "1",
        PROMPT: prompt,
        SAGE_SESSION_ID: sessionId,
        SAGE_WORKSPACE: workspaceDir,
        SAGE_MODEL: toStringOrEmpty(e?.model) || toStringOrEmpty(e?.context?.model),
        SAGE_PROVIDER: toStringOrEmpty(e?.provider) || toStringOrEmpty(e?.context?.provider),
        SAGE_CAPTURE_ATTRIBUTES_JSON: JSON.stringify(attrs),
      });
    });

    api.on("agent_end", async (evt: unknown) => {
      const response = lastAssistantText(evt);
      if (!response) return;

      const e = evt as any;
      const tokensIn =
        toStringOrEmpty(e?.usage?.tokens_input) ||
        toStringOrEmpty(e?.usage?.input_tokens) ||
        toStringOrEmpty(e?.usage?.inputTokens);
      const tokensOut =
        toStringOrEmpty(e?.usage?.tokens_output) ||
        toStringOrEmpty(e?.usage?.output_tokens) ||
        toStringOrEmpty(e?.usage?.outputTokens);

      fireAndForget("sage", ["capture", "hook", "response"], {
        SAGE_SOURCE: "openclaw",
        OPENCLAW: "1",
        LAST_RESPONSE: response,
        TOKENS_INPUT: tokensIn,
        TOKENS_OUTPUT: tokensOut,
      });
    });

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
