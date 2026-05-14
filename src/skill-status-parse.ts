import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

export type SkillStatusPathResolver = {
  exists?: (path: string) => boolean;
  realpath?: (path: string) => string;
};

export type SkillStatusPathResolution = {
  all: string[];
  preferred: string[];
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function parseStatusJson(status: unknown): unknown {
  if (typeof status !== "string") return status;
  const trimmed = status.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

export function extractSkillStatusDirectories(status: unknown): string[] {
  const parsed = parseStatusJson(status);
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  return unique([...asStringArray(record.global_paths), ...asStringArray(record.project_paths)]);
}

function isOpenClawSkillPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/.openclaw/");
}

export function resolveSkillStatusSkillMdRealpaths(
  status: unknown,
  resolver: SkillStatusPathResolver = {},
): SkillStatusPathResolution {
  const exists = resolver.exists ?? existsSync;
  const realpath = resolver.realpath ?? realpathSync;
  const resolved: string[] = [];

  for (const dir of extractSkillStatusDirectories(status)) {
    const skillMd = join(dir, "SKILL.md");
    try {
      if (!exists(skillMd)) continue;
      const rp = realpath(skillMd);
      if (rp) resolved.push(rp);
    } catch {
      // Ignore stale status entries or paths that cannot be resolved.
    }
  }

  const all = unique(resolved);
  const openclaw = all.filter(isOpenClawSkillPath);
  return {
    all,
    preferred: openclaw.length ? openclaw : all,
  };
}
