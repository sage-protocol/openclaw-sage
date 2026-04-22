# Sage Plugin (OpenClaw)

MCP bridge plugin that exposes Sage Protocol tools inside OpenClaw via Code Mode. It spawns the Sage MCP server as a child process and registers 3 fixed plugin tools; only external MCP server lifecycle is managed outside the plugin.

## What It Does

- **Code Mode Gateway** - Spawns `sage mcp start` and routes plugin calls through `sage_search`/`sage_execute`/`sage_status`
- **Agent Profile (Identity Context)** - Injects wallet, active libraries, and skill counts into every turn so the agent knows who it's working for
- **Auto-Context Injection** - Injects Sage tool context and skill suggestions via `before_prompt_build` with stable context cached separately from per-turn dynamic context
- **Injection Guard** - Optional prompt-injection scanning on outgoing `sage_execute` mutations
- **Crash Recovery** - Automatically restarts the MCP subprocess on unexpected exits
- **External Servers** - Sage internal tools are available immediately; only external MCP tools require starting servers first via the Sage app, CLI, or raw MCP `hub_*` tools

## Framework: Thin Harness, Fat Skills

OpenClaw should stay thin at the harness layer:

- fixed bridge tools
- context injection
- hook wiring
- lifecycle and safety guards

The judgment-heavy workflows should live in Sage skills and libraries.
That means this plugin gives you the bridge/context layer, while `sage init --openclaw`
adds the small base runtime skill layer (`sage`, `prompt-builder`, `sage-workflow`, `sage-p2p`).

Do not assume that every deeper Sage workflow, long-running operator skill, or entrypoint
library is automatically active just because the plugin is installed. Those richer
capabilities should be discoverable or activatable through Sage, not silently hard-coded
into the OpenClaw harness.

For source-of-truth clarity, separate these layers:

- `packages/openclaw-sage/` is the OpenClaw plugin bridge/context package
- `packages/sage/skills/` is the human-authored generic Sage core skill tree
- `packages/sage/crates/cli/src/commands/skills/data/` contains bundled `sage init` templates
- `packages/sage/crates/cli/src/commands/skills/entry_shared.rs` + `packages/sage/crates/cli/src/commands/skills/data/shared/` provide the shared conceptual sections that keep the bundled generic/Codex/Pi/onboarding `sage` entry surfaces aligned

## Distribution Surface Taxonomy

OpenClaw sessions should treat Sage distribution surfaces as distinct:

- **P2P** — trusted private sync across machines/agents
- **Shared library** — private collaboration with explicit members/invites
- **Personal cloud** — creator-controlled canonical publishing, public or private
- **Marketplace** — monetized packaged capability built from a polished public personal library
- **DAO promotion** — group/community canon with governance history, legitimacy, future tips/bounties, and repeated improvement

Governance chooser:
- **personal DAO** = fastest operator-controlled canon
- **team DAO** = trusted shared stewardship
- **community DAO** = strongest public curation and legitimacy

If one path is clearly implied by the user's goal, suggest it proactively instead of waiting for the exact Sage term.

## Agent Profile (Identity Context)

Every OpenClaw session automatically gets Sage Protocol identity context injected via the `before_prompt_build` hook. Stable context (protocol description, identity, tool docs) goes in `prependSystemContext` so providers can cache it across turns. Dynamic content (skill suggestions, security guard) goes in `prependContext` and refreshes each turn.

Example of what gets injected:

```
## Sage Protocol Context
Sage Protocol is a decentralized network for collaborative prompt, skill, and knowledge
curation on Base (L2). Skills and prompts live in libraries governed by DAOs. Creators
and curators earn when their work is used. SXXX is the governance token: hold it to
vote, create DAOs, and shape the protocol. Burns from activity create deflationary
pressure — early participants gain governance influence and economic upside as the
network grows. The more skills published, the more valuable discovery becomes for every
user and agent.

### Active Identity
- Wallet: 0x9794...507ca (privy, Base Sepolia)
- Active libraries (6): sage-entrypoints, impeccable-ui-review, sage-review-foundations, ...
- Libraries: 10 installed (48 skills, 12 prompts)
```

The context is fetched from the sage CLI (`wallet current`, `library active`, `library list`) and cached for 60 seconds. If the CLI is unavailable or any query fails, the identity block is silently omitted.

## Install

```bash
sage init --openclaw
```

This is the recommended product path: it installs the bundled OpenClaw plugin, the base Sage
runtime skills (`sage`, `prompt-builder`, `sage-workflow`, `sage-p2p`), and the matching internal
Sage/OpenClaw hook behavior. In that base skill layer, the bundled generic `sage` entry surface is now rendered from the shared entry-source layer in `packages/sage/crates/cli/src/commands/skills/entry_shared.rs` + `packages/sage/crates/cli/src/commands/skills/data/shared/`, so the product framing stays aligned with Codex and Pi instead of drifting by harness.

If you only want the raw plugin package flow, you can still run:

```bash
openclaw plugins install @sage-protocol/openclaw-sage
```

That direct install ships the native OpenClaw plugin and the plugin-managed internal hooks,
including `agent:bootstrap`, `command:new`, and `command:stop`.
It does **not** replace `sage init --openclaw` for installing the base Sage SKILL.md layer.

After install, **restart the Gateway** for the plugin to take effect.

CI validates the packed tarball against the latest published `openclaw` CLI by running
`npx openclaw@latest plugins install` in an isolated `OPENCLAW_HOME`.

Current upstream note: `openclaw@latest` (`2026.4.5` at the time of writing) can crash before
plugin inspection because its root runtime imports `@buape/carbon` without declaring it as a root
dependency. When that happens, this package still installs to the correct plugin path, but host-side
commands such as `plugins inspect`, `hooks list`, and `plugins doctor` can fail until OpenClaw fixes
that release.

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

### Auto-Enable

The plugin sets `enabledByDefault: true` in its manifest, so it auto-enables when referenced in `openclaw.json` config without needing a manual `plugins.allow` entry.

### Hook Priority

The `before_prompt_build` hook runs at priority 90 (higher = earlier). This ensures Sage's stable system context (protocol description, wallet identity, tool docs) is the base layer that other plugins build on. Dynamic per-turn content (skill suggestions, security guards) goes in `prependContext`.

### Secrets Management

Sage credentials support OpenClaw's SecretRef system instead of raw environment variables:

```json5
{
  "secrets": {
    "providers": {
      "default": { "source": "env", "allowlist": ["SAGE_*", "KEYSTORE_*"] }
    }
  }
}
```

The plugin declares three SecretRef-compatible credentials:
- `SAGE_IPFS_UPLOAD_TOKEN` — Bearer token for Worker API auth
- `KEYSTORE_PASSWORD` — Wallet keystore password (non-interactive)
- `SAGE_DELEGATE_KEYSTORE_PASSWORD` — Delegate keystore password (daemon/operator)

These are resolved through OpenClaw's secret provider chain (env, file, or exec) rather than passed as raw env vars.

### Login With Code (Privy Device-Code fallback)

Use this only when the user explicitly wants a Privy/provider-session path or the failing session is already clearly a Privy session. If the user already has a working direct-wallet preference, preserve it instead of forcing this flow.

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

This plugin uses OpenClaw's plugin hook API to inject context at the start of each prompt build via `before_prompt_build`.

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

Direct `openclaw plugins install @sage-protocol/openclaw-sage` registers the internal hooks from
the plugin at runtime, so bootstrap injection is active unless you disable it.

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
