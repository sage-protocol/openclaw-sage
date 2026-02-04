# Sage Plugin (OpenClaw)

MCP bridge plugin that exposes all Sage Protocol tools inside OpenClaw. Spawns the sage MCP server as a child process and translates JSON-RPC calls into registered OpenClaw tools.

## What It Does

- **MCP Tool Bridge** - Spawns `sage mcp start` and translates JSON-RPC tool calls into native OpenClaw tools
- **Dynamic Registration** - Discovers available tools at startup and registers them with typed schemas
- **RLM Capture** - Records prompt/response pairs for Sage's RLM feedback loop
- **Crash Recovery** - Automatically restarts the MCP subprocess on unexpected exits

## Install

```bash
openclaw plugins install @sage-protocol/openclaw-sage
```

## Configuration

The plugin auto-detects the `sage` binary from PATH. To override:

```json
{
  "sageBinary": "/path/to/sage"
}
```

### Auto-Inject / Auto-Suggest

This plugin uses OpenClaw's plugin hook API to inject context at the start of each agent run (`before_agent_start`).

Available config fields:

```json
{
  "autoInjectContext": true,
  "autoSuggestSkills": true,
  "suggestLimit": 3,
  "minPromptLen": 12,
  "maxPromptBytes": 16384
}
```

### Avoiding Double Injection

If you also enabled Sage's OpenClaw *internal hook* (installed by `sage init --openclaw`), both the hook and this plugin can inject Sage context.

- Recommended: keep the plugin injection on, and disable the internal hook injection via `SAGE_OPENCLAW_INJECT_CONTEXT=0` in your OpenClaw environment.

The internal hook exists mainly for bootstrap-file injection; the plugin is the preferred place for per-run injection and suggestions.

## What It Provides

Once loaded, all Sage MCP tools are available in OpenClaw:

- **Prompts & Libraries** - Search, list, create, and manage prompt libraries
- **Skills** - Discover and activate skills from Sage Protocol, GitHub, or local sources
- **Builder** - AI-powered prompt recommendations and synthesis
- **Governance** - List DAOs, view proposals, check voting power
- **Hub** - Start/stop additional MCP servers (memory, brave-search, github, etc.)

## Requirements

- Sage CLI on PATH
- OpenClaw v0.1.0+

## Development

```bash
npm install
npm run typecheck
npm test
```

## License

MIT
