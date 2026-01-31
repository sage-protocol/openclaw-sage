# @sage-protocol/openclaw-sage

Sage Protocol MCP bridge plugin for OpenClaw. Provides prompt libraries, skills, governance, and on-chain operations directly in OpenClaw sessions.

## Install

```bash
openclaw plugins install @sage-protocol/openclaw-sage
```

## Requirements

- [Sage CLI](https://github.com/sage-protocol/sage-cli) installed and available on PATH
- OpenClaw v0.1.0+

## Configuration

The plugin auto-detects the `sage` binary from PATH. To override:

```json
{
  "sageBinary": "/path/to/sage"
}
```

## What It Provides

The plugin exposes Sage Protocol MCP tools inside OpenClaw:

- **Prompts & Libraries** — search, list, create, and manage prompt libraries
- **Skills** — discover and activate skills from Sage Protocol, GitHub, or local sources
- **Builder** — AI-powered prompt recommendations and synthesis
- **Governance** — list DAOs, view proposals, check voting power
- **Hub** — start/stop additional MCP servers (memory, brave-search, github, etc.)

## Development

```bash
npm install
npm run typecheck
npm test
```

## License

MIT
