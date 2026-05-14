import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

import plugin from "./index.js";
import { runCommand } from "./runtime.js";
import { resolveSkillStatusSkillMdRealpaths } from "./skill-status-parse.js";

type RuntimeHooks = Record<string, any>;

function registerRuntimeHooks(pluginConfig?: Record<string, unknown>): RuntimeHooks {
  const runtimeHooks: RuntimeHooks = {};
  plugin.register({
    id: "e2e",
    name: "e2e",
    pluginConfig,
    logger: {
      info: (_: string) => {},
      warn: (_: string) => {},
      error: (_: string) => {},
    },
    registerTool: (_tool: any) => {},
    registerService: (_svc: any) => {},
    on: (hook: string, handler: any) => {
      runtimeHooks[hook] = handler;
    },
    registerHook: (hook: string, handler: any) => {
      runtimeHooks[hook] = handler;
    },
  } as any);
  return runtimeHooks;
}

function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  };
  return Promise.resolve().then(fn).finally(restore);
}

function sanitizeCorrelationPart(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "_");
}

function correlationPath(source: string, session: string): string {
  return join(tmpdir(), `sage_suggest_cid_${sanitizeCorrelationPart(source)}_${sanitizeCorrelationPart(session)}`);
}

function metricsDbPath(): string {
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "sage", "metrics.db");
}

async function sqliteJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const result = await runCommand("sqlite3", ["-json", dbPath, sql], { timeout: 5_000 });
  if (result.code !== 0) throw new Error(result.stderr || `sqlite3 exited ${result.code}`);
  if (!result.stdout.trim()) return [];
  return JSON.parse(result.stdout) as T[];
}

test(
  "OpenClaw SKILL.md hook persists suggestion use and skill execution with real sage",
  { skip: process.env.SAGE_E2E_OPENCLAW !== "1" },
  async (t) => {
    const sageBinary = process.env.SAGE_BIN || "sage";
    const daemonStatus = await runCommand(sageBinary, ["daemon", "status"], { timeout: 5_000 });
    if (daemonStatus.code !== 0 || !/running|ready|healthy/i.test(`${daemonStatus.stdout}\n${daemonStatus.stderr}`)) {
      t.skip("Sage daemon is not healthy");
      return;
    }

    const dbPath = metricsDbPath();
    if (!existsSync(dbPath)) {
      t.skip(`metrics.db not found at ${dbPath}`);
      return;
    }
    const sqliteCheck = await runCommand("sqlite3", ["--version"], { timeout: 5_000 });
    if (sqliteCheck.code !== 0) {
      t.skip("sqlite3 CLI is not available for persistence assertions");
      return;
    }

    const baseSession = `openclaw-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const correlationSession = `${baseSession}__turn_1`;
    const prompt = `Sage chat collaboration bounties tips follows OpenClaw SKILL.md read detection e2e ${baseSession}`;

    await withEnv(
      {
        SAGE_CAPTURE_HOOKS: "0",
        SAGE_OPENCLAW_SECURITY_SCAN: "0",
      },
      async () => {
        const hooks = registerRuntimeHooks({
          sageBinary,
          autoInjectContext: false,
          toolCallHookEnabled: true,
          suggestLimit: 3,
        });

        const promptResult = await hooks["before_prompt_build"]({ prompt }, { sessionKey: baseSession });
        const context = String(promptResult?.prependContext || "");
        const key = context.match(/"key"\s*:\s*"([^"]+)"/)?.[1];
        if (!key) {
          t.skip("No correlated, status-verified skill was suggested by the local Sage installation");
          return;
        }

        const cidPath = correlationPath("openclaw-hook", correlationSession);
        assert.ok(existsSync(cidPath), `expected correlation id file at ${cidPath}`);

        const status = await runCommand(sageBinary, ["skill", "status", key, "--format", "json"], {
          timeout: 5_000,
        });
        assert.equal(status.code, 0, status.stderr);
        const paths = resolveSkillStatusSkillMdRealpaths(status.stdout).preferred;
        if (!paths.length) {
          t.skip(`Suggested skill ${key} has no realpath-resolvable SKILL.md status path`);
          return;
        }

        await hooks["after_tool_call"](
          { toolName: "Read", params: { path: paths[0] } },
          { sessionKey: baseSession },
        );
        await hooks["agent_end"]({ success: true, response: "done" }, { sessionKey: baseSession });

        const suggestionRows = await sqliteJson<{ skills_used: string }>(
          dbPath,
          `SELECT skills_used FROM suggestion_captures WHERE source='openclaw-hook' AND prompt=${JSON.stringify(prompt)} ORDER BY timestamp DESC LIMIT 1`,
        );
        assert.equal(suggestionRows.length, 1);
        const skillsUsed = JSON.parse(suggestionRows[0].skills_used || "[]") as string[];
        assert.ok(skillsUsed.includes(key));

        const executionRows = await sqliteJson<{
          skill_key: string;
          source: string;
          status: string;
          session_id: string;
          query_preview: string;
        }>(
          dbPath,
          `SELECT skill_key, source, status, session_id, query_preview FROM skill_execution WHERE source='openclaw-hook' AND session_id=${JSON.stringify(baseSession)} AND skill_key=${JSON.stringify(key)} ORDER BY timestamp DESC LIMIT 1`,
        );
        assert.equal(executionRows.length, 1);
        assert.equal(executionRows[0].source, "openclaw-hook");
        assert.equal(executionRows[0].session_id, baseSession);
        assert.equal(executionRows[0].status, "passed");
        assert.match(executionRows[0].query_preview, /OpenClaw SKILL\.md read detection e2e/);
      },
    );
  },
);
