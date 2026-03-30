# Sage Plugin (OpenClaw)

MCP bridge plugin that exposes Sage Protocol tools inside OpenClaw via Code Mode. It spawns the Sage MCP server as a child process and registers 3 fixed plugin tools; only external MCP server lifecycle is managed outside the plugin.

## What It Does

- **Code Mode Gateway** - Spawns `sage mcp start` and routes plugin calls through `sage_search`/`sage_execute`/`sage_status`
- **Auto-Context Injection** - Injects Sage tool context and skill suggestions at agent start
- **Injection Guard** - Optional prompt-injection scanning on outgoing `sage_execute` mutations
- **Crash Recovery** - Automatically restarts the MCP subprocess on unexpected exits
- **External Servers** - Sage internal tools are available immediately; only external MCP tools require starting servers first via the Sage app, CLI, or raw MCP `hub_*` tools

## Install

```bash
sage init --openclaw
```

This is the recommended product path: it installs the bundled OpenClaw plugin, the companion Sage
skills, and only the scan-only internal hooks.

If you only want the raw plugin package flow, you can still run:

```bash
openclaw plugins install @sage-protocol/openclaw-sage
```

After install, **restart the Gateway** for the plugin to take effect.

### Verify

```bash
openclaw plugins list
openclaw plugins info openclaw-sage
```

### Update

```bash
openclaw plugins update openclaw-sage
# or update all plugins at once
openclaw plugins update --all
```

### Login With Code (Privy Device-Code)

If browser OAuth is unreliable, use:

```bash
sage wallet connect privy --device-code
```

The CLI prints:

- `verification_uri_complete` (open this first)
- `verification_uri` + `user_code` (manual fallback)

Verify connection:

```bash
sage wallet current
sage daemon status
```

Refresh stale sessions:

```bash
sage wallet connect privy --force --device-code
```

### Discovery Workflow (Avoid DAO/CID Dead-Ends)

Before asking users for DAO/CID, run:

```bash
sage governance dao discover --limit 50
sage library discover
sage search "<query>" --search-type skills --scope both --limit 20
sage search "<query>" --search-type libraries --scope remote --limit 20
```

If command surface differs across machines, verify with `sage --help` / `sage skill --help` and adapt.

### High-Value CLI Recipes

Use these when users want direct Rust CLI commands:

```bash
# Library management
sage library create <name>
sage library skill add <path> -l <library>
sage library prompt add <prompt-name> -l <library> --file <path>
sage library push <library>
sage library promote <library> --dao 0x... --collection default

# DAO creation
sage governance dao create --name "My DAO" --description "..." --governance personal
sage governance dao create --name "Team DAO" --description "..." --governance team --operator 0x...
sage governance dao create --name "Community DAO" --description "..." --governance community --burn 1500

# Bounty creation
sage bounties create --title "Task" --description "..." --reward 100 --deadline 7d --subdao 0x...
sage bounties create --mode direct --assignee 0x... --title "Task" --description "..." --reward 100 --deadline 7d --subdao 0x...
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

### Soul Stream Context (Optional)

You can prepend a locally synced DAO soul stream document to each run by setting:

```json
{
  "soulStreamDao": "0xabc123...",
  "soulStreamLibraryId": "soul"
}
```

This reads `~/.local/share/sage/souls/<subdao>-<libraryId>.md` when present.

### Injection Guard (Opt-In)

This plugin can optionally scan outgoing `sage_execute` mutation params for common prompt-injection / jailbreak patterns using Sage's built-in deterministic scanner. The Rust layer handles incoming content scanning server-side.

By default this is **off**.

```json
{
  "injectionGuardEnabled": true,
  "injectionGuardMode": "warn",
  "injectionGuardScanAgentPrompt": true,
  "injectionGuardUsePromptGuard": false,
  "injectionGuardMaxChars": 32768,
  "injectionGuardIncludeEvidence": false
}
```

Notes:

- `injectionGuardMode=block` blocks `sage_execute` calls whose params are flagged.
- `injectionGuardScanAgentPrompt` scans the agent's initial prompt at start.
- `injectionGuardUsePromptGuard` sends text to HuggingFace Prompt Guard if `SAGE_PROMPT_GUARD_API_KEY` is set; keep this off unless you explicitly want third-party scanning.
- Scanner coverage follows Sage CLI/security rules, so updated prompt-injection patterns in Sage can increase warn/block detections when `injectionGuardEnabled=true`.

### Avoiding Double Injection

If you also enabled Sage's OpenClaw _internal hook_ (installed by `sage init`), both the hook and this plugin can inject Sage context.

- `sage init --openclaw` now defaults to plugin-first setup and only installs scan-only hooks, so duplicate injection should not happen by default.
- Only `sage init --openclaw --mode hooks` installs the legacy `agent:bootstrap` injection hook.
- If you deliberately re-enable bootstrap injection alongside the plugin, disable it with `SAGE_OPENCLAW_INJECT_CONTEXT=0`.

The internal hook now also scans `command:new` and `command:stop` through `sage security scan-hook` and prepends warnings when suspicious content is detected.

You can disable internal-hook scanning independently with `SAGE_OPENCLAW_SECURITY_SCAN=0`.

The plugin remains the preferred place for per-run injection and suggestions.

## What It Provides

The plugin registers 3 fixed tools via Code Mode, replacing 60+ dynamic tool registrations. Sage internal domains work immediately through these tools. Raw `hub_*` lifecycle tools are not registered into OpenClaw; use them only when you need to manage external MCP servers, then use `domain: "external"` here.

### `sage_search` — Read-only search across all domains

```
sage_search({domain: "prompts", action: "search", params: {query: "rust MCP"}})
sage_search({domain: "skills", action: "list"})
sage_search({domain: "governance", action: "list_subdaos"})
sage_search({domain: "help", action: "list"})  // discover all actions
sage_search({domain: "external", action: "list_servers"})
```

Domains: `prompts`, `skills`, `builder`, `governance`, `chat`, `social`, `rlm`, `library_sync`, `security`, `meta`, `help`, `external`

To manage external MCP servers directly outside OpenClaw, use the Sage app MCP screen, Sage CLI, or the raw MCP server's direct hub tools such as `hub_list_servers`, `hub_start_server`, `hub_status`, and `hub_stop_server`.

### `sage_execute` — Mutations across any domain or external server

```
sage_execute({domain: "skills", action: "use", params: {key: "mcp-builder"}})
sage_execute({domain: "external", action: "execute", params: {server_id: "github", tool_name: "list_repos"}})
sage_execute({domain: "external", action: "call", params: {tool_name: "search", tool_params: {q: "..."}}})
```

### `sage_status` — Bridge health, wallet, network status

## Requirements

- Sage CLI on PATH (v0.9.16+)
- OpenClaw v0.1.0+

## Development

```bash
npm install
npm run typecheck
npm test
# optional real-binary e2e (requires local sage binary)
npm run test:e2e
```

## License

MIT
