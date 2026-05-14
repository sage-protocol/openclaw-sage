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
| Hooks | Emits capture/RLM signals, can scan hook content for suspicious prompts, and can opt into inferred `SKILL.md` read feedback |
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
  "toolCallHookEnabled": false,
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
- `toolCallHookEnabled` enables the opt-in `SKILL.md` read detector. The same behavior can be enabled for a process with `OPENCLAW_SAGE_TOOL_CALL_HOOK=1`. It is default-off and read once at plugin registration; restart/reload OpenClaw after changing it.
- `soulStreamDao` and `soulStreamLibraryId` opt into local soul stream context on governance-relevant turns.
- `injectionGuardEnabled` enables deterministic prompt-injection scanning for outgoing `sage_execute` mutations.

Secrets should use OpenClaw SecretRef providers rather than raw prompt text.
Declared credentials are `SAGE_IPFS_UPLOAD_TOKEN`, `KEYSTORE_PASSWORD`, and
`SAGE_DELEGATE_KEYSTORE_PASSWORD`.

### Inferred SKILL.md read feedback (default off)

OpenClaw has two Sage skill-use lineages:

- `source=openclaw` — explicit agent calls to `sage_execute({ "domain": "skills", "action": "use" })`.
- `source=openclaw-hook` — inferred reads of a correlated Sage-exposed `SKILL.md` file when `toolCallHookEnabled: true` or `OPENCLAW_SAGE_TOOL_CALL_HOOK=1`.

The inferred hook deliberately uses existing Sage CLI surfaces only. On each
turn it creates a correlation with:

```bash
sage suggest skill "<prompt>" --format json --limit <N> --source openclaw-hook --session <baseSession>__turn_<N>
```

It then resolves each suggested skill with `sage skill status <key> --format json`
and trusts only `global_paths[]` / `project_paths[]` entries that become existing
realpaths after appending `/SKILL.md`. OpenClaw exposure paths such as
`~/.openclaw/...` are preferred; otherwise all verified Sage-exposed paths are
cached. A read counts only when the read realpath is in that expected set and
the `SKILL.md` frontmatter `name:` matches its parent directory basename (or no
frontmatter name is present).

At terminal flush, the hook emits exactly one use-feedback process for each
non-empty correlation:

```bash
sage suggest feedback use --used K1 K2 ... --source openclaw-hook --session <baseSession>__turn_<N>
```

Outcomes are emitted per used skill against the base session:

```bash
sage suggest feedback outcome <key> --status passed|failed --source openclaw-hook --session <baseSession> --query-preview <preview>
```

This is a weaker inferred signal than explicit `sage_execute` use. Keep it
default-off until daemon/RLM weighting treats `openclaw-hook` as a weak-prior
source before any default-on rollout. The remaining default-on prerequisites are
tracked in `plans/2026-05-11-001-feat-openclaw-skill-use-detection-plan.md`:
D1 source weighting, D2 orphan-correlation cleanup, and D3 optional abandoned
correlation feedback.

To observe a live run:

```bash
sage capture list --source openclaw-hook --limit 20
sage capture status
grep -R "\[sage-skill-read\]" ~/.openclaw 2>/dev/null | tail -50
```

`sage suggest history` is not the validation surface for this path. The
`[sage-skill-read]` prefix distinguishes benign info-level misses from warning
events such as failed feedback subprocesses or state-bound evictions.

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

If OpenClaw fails to inspect plugins, run `openclaw plugins list`,
`openclaw plugins info openclaw-sage`, and `sage doctor --include-details` in
the same shell. If the package is installed but inspection still fails, restart
the OpenClaw gateway and verify the host OpenClaw runtime can load plugins.

## Sage CLI Quick Reference

Use these commands from the same shell that launches OpenClaw:

| Goal | Command |
| --- | --- |
| Runtime health | `sage doctor --include-details` |
| OpenClaw setup | `sage init --openclaw --mode plugin --yes` |
| Onboarding status | `sage agent quickstart --check` |
| Start MCP bridge manually | `sage mcp start` |
| Search skills | `sage search "<query>" --search-type skills --scope both --limit 20` |
| Search libraries | `sage search "<query>" --search-type libraries --scope remote --limit 20` |
| Capture status | `sage capture status` |
| Learned patterns | `sage metrics list-patterns --limit 20` |
| Create local library | `sage library create "my-workflow"` |
| Use local library | `sage library use "my-workflow"` |
| Push private cloud library | `sage library push "my-workflow" --cloud` |
| Discover DAOs | `sage governance dao discover --limit 50` |

Run `sage <command> --help` before editing docs or automating a flow. Sage CLI
surfaces can move, and the plugin should document the command that actually
exists on the installed binary.

## Distribution Surfaces

Sage has several sharing surfaces. Pick the smallest one that matches the
operator's intent:

- Local install/expose makes a prompt, skill, or library usable on this machine.
- P2P and shared libraries sync with trusted collaborators without public discovery.
- Personal cloud hosts a creator-controlled library and stays private by default.
- Marketplace publishing is for polished public artifacts the author wants to sell or distribute broadly.
- DAO promotion is for long-term public canon with governance provenance.
- Tips, bounties, reflections, and rewards are value-network actions; use them only after explicit user intent.

Never treat install, sync, save, or use as permission to publish, sell, vote,
tip, claim, or promote.

## Package Docs

- [AGENTS.md](AGENTS.md) - operational runbooks and current command recipes
- [SOUL.md](SOUL.md) - compact OpenClaw agent posture

This README is self-contained for package consumers. It does not require access
to the Sage monorepo docs.

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

Equivalent monorepo form:

```bash
SAGE_E2E_OPENCLAW=1 npm test --workspace packages/openclaw-sage
```

The gated e2e verifies persisted Sage data: correlated `suggestion_captures`
receive all used keys, and `skill_execution` stores
`source=openclaw-hook`, the base session id, status, and query preview.

## License

MIT
