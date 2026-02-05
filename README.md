# Sage Plugin (OpenClaw)

MCP bridge plugin that exposes all Sage Protocol tools inside OpenClaw. Spawns the sage MCP server as a child process and translates JSON-RPC calls into registered OpenClaw tools.

## What It Does

- **MCP Tool Bridge** - Spawns `sage mcp start` and translates JSON-RPC tool calls into native OpenClaw tools
- **Dynamic Registration** - Discovers 60+ tools at startup and registers them with typed schemas
- **Auto-Context Injection** - Injects Sage tool context and skill suggestions at agent start
- **Error Context** - Enriches error messages with actionable hints (wallet, auth, network, credits)
- **Injection Guard** - Optional prompt-injection scanning for fetched prompt content
- **Crash Recovery** - Automatically restarts the MCP subprocess on unexpected exits
- **External Servers** - Loads additional MCP servers from `~/.config/sage/mcp-servers.toml`

## Install

```bash
openclaw plugins install @sage-protocol/openclaw-sage
```

## Configuration

The plugin auto-detects the `sage` binary from PATH. To override:

```json
{
  "sageBinary": "/path/to/sage",
  "sageProfile": "testnet"
}
```

The `sageProfile` field maps to `SAGE_PROFILE` and controls which network/wallet the CLI uses. The plugin also passes through these env vars when set: `SAGE_PROFILE`, `SAGE_PAY_TO_PIN`, `SAGE_IPFS_WORKER_URL`, `SAGE_API_URL`, `KEYSTORE_PASSWORD`.

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

### Injection Guard (Opt-In)

This plugin can optionally scan the agent prompt and fetched prompt content (e.g. from `sage_get_prompt`) for common prompt-injection / jailbreak patterns using Sage's built-in deterministic scanner.

By default this is **off**.

```json
{
  "injectionGuardEnabled": true,
  "injectionGuardMode": "warn",
  "injectionGuardScanAgentPrompt": true,
  "injectionGuardScanGetPrompt": true,
  "injectionGuardUsePromptGuard": false,
  "injectionGuardMaxChars": 32768,
  "injectionGuardIncludeEvidence": false
}
```

Notes:
- `injectionGuardMode=block` blocks `sage_get_prompt` results that are flagged, but cannot reliably abort the overall agent run (it injects a warning at start instead).
- `injectionGuardUsePromptGuard` sends text to HuggingFace Prompt Guard if `SAGE_PROMPT_GUARD_API_KEY` is set; keep this off unless you explicitly want third-party scanning.

### Avoiding Double Injection

If you also enabled Sage's OpenClaw *internal hook* (installed by `sage init --openclaw`), both the hook and this plugin can inject Sage context.

- Recommended: keep the plugin injection on, and disable the internal hook injection via `SAGE_OPENCLAW_INJECT_CONTEXT=0` in your OpenClaw environment.

The internal hook exists mainly for bootstrap-file injection; the plugin is the preferred place for per-run injection and suggestions.

## What It Provides

Once loaded, all Sage MCP tools are available in OpenClaw with a `sage_` prefix:

### Prompts & Libraries
- `sage_search_prompts` - Hybrid keyword + semantic search
- `sage_list_prompts` - Browse prompts by source
- `sage_get_prompt` - Full prompt content
- `sage_quick_create_prompt` - Create new prompts
- `sage_list_libraries` - Local/on-chain libraries

### Skills
- `sage_search_skills` / `sage_list_skills` - Find skills
- `sage_get_skill` - Skill details and content
- `sage_use_skill` - Activate a skill (auto-provisions MCP servers)
- `sage_sync_skills` - Sync from daemon

### Builder
- `sage_builder_recommend` - AI-powered prompt suggestions
- `sage_builder_synthesize` - Synthesize from intent
- `sage_builder_vote` - Feedback on recommendations

### Governance & DAOs
- `sage_list_subdaos` - List available DAOs
- `sage_list_proposals` / `sage_list_governance_proposals` - View proposals
- `sage_list_governance_votes` - Vote breakdown
- `sage_get_voting_power` - Voting power with NFT multipliers

### Tips, Bounties & Marketplace
- `sage_list_tips` / `sage_list_tip_stats` - Tips activity and stats
- `sage_list_bounties` - Open/completed bounties
- `sage_list_bounty_library_additions` - Pending library merges

### Chat & Social
- `sage_chat_list_rooms` / `sage_chat_send` / `sage_chat_history` - Real-time messaging

### RLM (Recursive Language Model)
- `sage_rlm_stats` - Statistics and capture counts
- `sage_rlm_analyze_captures` - Analyze captured data
- `sage_rlm_list_patterns` - Discovered patterns

### Memory & Knowledge Graph
- `sage_memory_create_entities` / `sage_memory_search_nodes` / `sage_memory_read_graph`

### Hub (External MCP Servers)
- `sage_hub_list_servers` - List available MCP servers
- `sage_hub_start_server` - Start a server
- `sage_hub_stop_server` - Stop a server
- `sage_hub_status` - Check running servers

### Plugin Meta
- `sage_status` - Bridge health, wallet, network, tool count

## Requirements

- Sage CLI on PATH (v0.9.16+)
- OpenClaw v0.1.0+

## Development

```bash
npm install
npm run typecheck
npm test
```

## License

MIT
