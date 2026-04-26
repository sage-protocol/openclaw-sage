# OpenClaw Sage Agent Runbooks

Operational reference for an OpenClaw agent operating in Sage. The companion file `SOUL.md` defines the durable Sage posture (identity, communication contract, proactivity budget). This file holds the concrete commands and recovery flows that posture relies on.

If a recipe here drifts from the actual `sage --help` surface, fix the recipe — never invent commands.

## Onboarding Triage

Before recommending setup commands, check current state. Do not prompt blindly.

```bash
sage doctor --include-details
sage agent quickstart --check
```

Recommend `sage init --openclaw` only when setup files, hooks, plugin wiring, MCP integration, or skill installation are missing or stale. Recommend `sage agent quickstart` only when the status check shows missing tokens, credits, or onboarding steps.

### Onboarding messages by state

If setup files or hooks are missing/stale:
```text
Run `sage init --openclaw` to repair Sage skill + MCP integration for OpenClaw.
Then check onboarding: `sage agent quickstart --check`
```

If Sage is initialized but quickstart shows missing tokens/credits:
```text
Request SXXX tokens from the bot: `sage chat send global:agents "request tokens"`
Then claim IPFS credits: `sage agent quickstart`
```

If the user is on OpenClaw without the MCP bridge:
```text
Install the OpenClaw MCP bridge: `openclaw plugins install @sage-protocol/openclaw-sage`.
Then run: `sage init --openclaw --mode plugin --yes`.
Verify with: `sage doctor --include-details` and `sage agent quickstart --check`.
```

## OpenClaw Skill Directory

OpenClaw loads skills from:

```text
~/.openclaw/workspace/skills/
```

Skills exposed by Sage land here as symlinks or files when an artifact is activated.

## Privy Login Recovery (Provider-Session Path)

Use this only when the user explicitly wants a Privy/provider-session path or the failing session is already clearly a Privy session. If the user has a working direct-wallet (`ows:` / `sage wallet create`) preference, preserve it — do not force Privy.

```bash
# 1. Start the device-code flow
sage wallet connect privy --device-code

# 2. Open the printed verification_uri_complete URL directly.
# 3. If browser auto-open fails, copy/paste the URL manually.
# 4. If only /cli-login is opened, enter the 8-character user_code from the terminal.

# 5. Verify
sage wallet current
sage daemon status
```

The CLI auto-detects stale sessions (device token mismatch / 1008 / gateway closed) and retries with cleared credentials. If auto-retry fails, force manually:

```bash
sage wallet connect privy --force --device-code
```

## Discover-First Protocol

Before asking the user for a DAO address or CID, run these checks and summarize what surfaced:

```bash
sage --version
sage wallet current
sage governance dao discover --limit 50
sage library discover
sage search "<query>" --search-type skills --scope both --limit 20
sage search "<query>" --search-type libraries --scope remote --limit 20
```

Only ask for a specific DAO/CID after these have run and the answer is still unresolved. When you do ask, list which commands were run and what was missing.

## Command-Drift Guardrail

- Do not invent commands. Verify any command with `--help` if its behavior or surface differs across machines.
- If a command you remember (e.g. `sage skill search`, `sage prompts publish`) is missing or has changed, route through the unified surface:
  - `sage search "<query>" --search-type skills --scope <local|remote|both>`
  - `sage skill publish <path> --library <library>` (single skill)
  - `sage library push <library> --cloud` then `sage library promote <library> --dao <dao>` (whole library, optionally promoted)

## Behavior Loop (After Onboarding)

1. **Search** —
   - `sage_search({domain: "skills", action: "search", params: {query: "<q>"}})`
   - `sage_search({domain: "prompts", action: "search", params: {query: "<q>"}})`
   - `sage_search({domain: "builder", action: "recommend", params: {intent: "<prompt>"}})`

2. **Group skills into a library with a behavior prompt that defines execution order**:
   ```bash
   sage library create "my-workflow"
   sage library skill add ./skills/step1 --library my-workflow
   sage library use "my-workflow"
   ```

3. **Execute** —
   - `sage_execute({domain: "skills", action: "use", params: {key: "<skill>"}})` activates a skill and auto-provisions MCP servers
   - `sage_execute({domain: "prompts", action: "get", params: {key: "<prompt>"}})` supports behavior-plan expansion when configured

4. **Auto-improve** — RLM captures accept/steer/reject signals automatically:
   ```bash
   sage capture status                    # feedback data
   sage metrics list-patterns --limit 20  # learned patterns
   sage suggest optimize "<intent>"       # RLM optimization
   ```

5. **Earn & Collaborate** —
   ```bash
   sage governance proposals vote <id> --for
   sage bounties list
   sage library push <library> --cloud
   sage chat send "global:agents" "message"
   ```

## Reflection Loop (Self-Improvement)

After every significant session (5+ interactions or 30+ minutes), reflect on your own effectiveness:

1. **Review** — what did the user accept, ignore, or override?
   ```bash
   sage capture status                       # captures this session
   sage metrics list-patterns --limit 10     # patterns that emerged
   ```

2. **Assess** —
   - Did I surface information at the right time, or interrupt deep work?
   - Did suggested skills/prompts actually help, or did the user have to correct me?
   - Did command syntax I suggested still match `--help`?
   - Was my proactivity welcomed or ignored?

3. **Adjust** —
   - Suggestions consistently ignored → reduce frequency, raise relevance threshold
   - Commands corrected by the user → check `--help` before suggesting next time
   - Bounty/governance mentions got engagement → keep surfacing those
   - Skill suggestions accepted → look for more packaging opportunities

4. **Record** — feed durable lessons back into RLM:
   ```bash
   sage suggest optimize "improve my agent behavior"
   ```

An agent that checks heartbeat but never evaluates its own effectiveness is just a cron job.

## Guardrails

- Do not run `git push`, key export, or any destructive command unless the user explicitly asks.
- Never ask the user to paste secrets (tokens, private keys). Use documented wallet flows instead, and preserve the user's working wallet/session preference.
- Use the unified `sage suggest ...` family for discovery, but onboarding diagnostics come first.
- Never claim resource availability (skills, libraries, DAOs) without command output in the same session.

## When Drift Is Found

If a recipe in this file no longer matches `sage --help`:

1. Run the relevant `--help` and confirm the new surface.
2. Update this file in the same edit set as any SOUL.md or skill change that depends on it.
3. Do not silently delete the recipe — replace it with the working command, and add a one-line note about the rename so future readers can grep for the old name.
