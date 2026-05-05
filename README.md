# OpenClaw Sage Plugin

OpenClaw bridge for Sage Protocol.

This plugin connects OpenClaw Code Mode to the local `sage` CLI and MCP server.
It gives OpenClaw agents a small, deliberate Sage surface for finding and using
prompts, skills, behaviors, libraries, and MCP/tool bundles. When a workflow is
worth saving or sharing, Sage can route it into private sync, shared libraries,
personal cloud, marketplace sales, DAO promotion, tips, bounties, reflections,
and Base L2 governance.

## What It Does

| Surface | What the plugin provides |
| --- | --- |
| Code Mode tools | `sage_search`, `sage_execute`, and `sage_status` |
| MCP bridge | Starts `sage mcp start`, forwards JSON-RPC calls, and restarts after crashes |
| OpenClaw context | Adds a compact Sage capability card and optional wallet/library identity summary |
| Hooks | Emits capture/RLM signals and can scan hook content for suspicious prompts |
| Safety posture | Keeps Sage quiet by default on ordinary prompts; richer discovery requires `@sage`, direct tool use, heartbeat, or explicit config |

The plugin is a thin harness. Judgment-heavy workflows belong in Sage skills and
libraries, not hard-coded OpenClaw context.

## Get Started

Install the Sage CLI first:

```bash
npm install -g @sage-protocol/cli
sage --version
```

Initialize Sage for OpenClaw inside your project:

```bash
sage init --openclaw --mode plugin --yes
sage doctor --include-details
sage agent quickstart --check
```

Install the packaged OpenClaw plugin when you want the full published bridge with
`before_prompt_build` context injection and plugin-managed hooks:

```bash
openclaw plugins install @sage-protocol/openclaw-sage
```

Restart the OpenClaw gateway after installing or updating plugins.

## Use It

Ask for Sage explicitly when you want prior art or reusable capabilities:

```text
@sage find a skill or behavior for reviewing this implementation plan
```

Or call the Code Mode tools directly:

```text
sage_search({domain: "skills", action: "search", params: {query: "implementation plan review"}})
sage_search({domain: "builder", action: "recommend", params: {intent: "review this rollout"}})
sage_execute({domain: "skills", action: "use", params: {key: "review-helper"}})
sage_status({})
```

Start with search and inspection. Use `sage_execute` only when the operator's
intent and authority are clear.

## Tool Surface

- `sage_search` is read-only search/list/get/inspect across Sage domains.
- `sage_execute` activates skills or performs mutations across Sage domains and external MCP servers.
- `sage_status` reports bridge health, wallet, network, and runtime posture.

Common domains: `prompts`, `skills`, `builder`, `governance`, `chat`, `social`,
`rlm`, `library_sync`, `security`, `meta`, `help`, and `external`.

Use `sage_search({domain: "help", action: "list"})` to discover supported
actions when needed.

## Configuration

Defaults are intentionally quiet:

```json
{
  "autoInjectContext": true,
  "autoSuggestSkills": false,
  "suggestLimit": 3,
  "minPromptLen": 12,
  "maxPromptBytes": 16384
}
```

Important options:

- `sageBinary` sets the Sage CLI path. Default: `sage` from `PATH`.
- `sageProfile` maps to `SAGE_PROFILE`.
- `autoInjectContext` adds the compact Sage capability and identity context.
- `autoSuggestSkills` restores legacy unsolicited skill suggestions on ordinary prompts.
- `soulStreamDao` and `soulStreamLibraryId` opt into local soul stream context on governance-relevant turns.
- `injectionGuardEnabled` enables deterministic prompt-injection scanning for outgoing `sage_execute` mutations.

Secrets should use OpenClaw SecretRef providers rather than raw prompt text.
Declared credentials are `SAGE_IPFS_UPLOAD_TOKEN`, `KEYSTORE_PASSWORD`, and
`SAGE_DELEGATE_KEYSTORE_PASSWORD`.

## Setup Modes

- `sage init --openclaw --mode plugin --yes` installs Sage's OpenClaw skill/SOUL layer and bridge-oriented plugin template.
- `openclaw plugins install @sage-protocol/openclaw-sage` installs the full published OpenClaw package plugin.
- Plugin install alone does not install the Sage skill bundle into `~/.openclaw/workspace/skills/`.
- `sage init --openclaw --mode hooks --yes` exists for legacy hook-only wiring.
- `sage init --openclaw --mode hybrid --yes` combines plugin and hook paths for explicit migration/debug scenarios.

## Verify

```bash
openclaw plugins list
openclaw plugins info openclaw-sage
sage doctor --include-details
sage agent quickstart --check
```

If OpenClaw fails to inspect plugins because a bundled OpenClaw runtime dependency
is missing, check `plugin-install.txt` and `plugin-doctor.txt` for the current
host-side failure. The plugin can still install to the correct path while the
host runtime is broken.

## Learn More

- [AGENTS.md](AGENTS.md) - operational runbooks and current command recipes
- [SOUL.md](SOUL.md) - compact OpenClaw agent posture
- [CONTRIBUTING-SKILL-FILES.md](CONTRIBUTING-SKILL-FILES.md) - rules for editing runtime agent files
- [Sage IDE Integration](../sage/docs/ide-integration.md)
- [Sage CLI Reference](../sage/docs/cli-reference.md)
- [Sage Vault / Harness Context](../sage/docs/SAGE_VAULT.md)
- [Sage Distribution Surfaces](../sage/skills/sage/references/distribution-surface.md)

## Requirements

- Sage CLI on `PATH` (`sage --version`)
- OpenClaw with plugin support
- Node.js compatible with the package lockfile

## Development

```bash
npm install
npm run typecheck
npm test
```

Optional real-binary e2e requires a local Sage binary:

```bash
npm run test:e2e
```

## License

MIT
