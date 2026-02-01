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
