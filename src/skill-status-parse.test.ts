import test from "node:test";
import assert from "node:assert/strict";

import {
  extractSkillStatusDirectories,
  resolveSkillStatusSkillMdRealpaths,
} from "./skill-status-parse.js";

test("extractSkillStatusDirectories reads only global_paths and project_paths", () => {
  assert.deepEqual(
    extractSkillStatusDirectories({
      global_paths: ["/g/a", "", 42, "/g/a"],
      project_paths: ["/p/b"],
      ide_directories: ["/invented/shape"],
    }),
    ["/g/a", "/p/b"],
  );
});

test("resolveSkillStatusSkillMdRealpaths appends SKILL.md, exists-checks, and realpaths", () => {
  const existing = new Set(["/g/a/SKILL.md", "/p/b/SKILL.md"]);
  const resolution = resolveSkillStatusSkillMdRealpaths(
    { global_paths: ["/g/a", "/missing"], project_paths: ["/p/b"] },
    {
      exists: (path) => existing.has(path),
      realpath: (path) => `/real${path}`,
    },
  );

  assert.deepEqual(resolution.all, ["/real/g/a/SKILL.md", "/real/p/b/SKILL.md"]);
  assert.deepEqual(resolution.preferred, resolution.all);
});

test("resolveSkillStatusSkillMdRealpaths prefers OpenClaw exposure paths", () => {
  const existing = new Set([
    "/Users/test/.openclaw/workspace/skills/a/SKILL.md",
    "/Users/test/.claude/skills/a/SKILL.md",
  ]);
  const resolution = resolveSkillStatusSkillMdRealpaths(
    {
      global_paths: ["/Users/test/.claude/skills/a"],
      project_paths: ["/Users/test/.openclaw/workspace/skills/a"],
    },
    {
      exists: (path) => existing.has(path),
      realpath: (path) => path,
    },
  );

  assert.deepEqual(resolution.all, [
    "/Users/test/.claude/skills/a/SKILL.md",
    "/Users/test/.openclaw/workspace/skills/a/SKILL.md",
  ]);
  assert.deepEqual(resolution.preferred, [
    "/Users/test/.openclaw/workspace/skills/a/SKILL.md",
  ]);
});

test("resolveSkillStatusSkillMdRealpaths parses JSON strings and ignores stale paths", () => {
  const resolution = resolveSkillStatusSkillMdRealpaths(
    JSON.stringify({ global_paths: ["/stale"], project_paths: ["/ok"] }),
    {
      exists: (path) => path === "/ok/SKILL.md",
      realpath: (path) => (path === "/ok/SKILL.md" ? "/real/ok/SKILL.md" : (() => { throw new Error("stale"); })()),
    },
  );

  assert.deepEqual(resolution.preferred, ["/real/ok/SKILL.md"]);
});
