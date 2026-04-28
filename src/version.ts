import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { envGet } from "./runtime.js";

const BUILD_VERSION = "__PKG_VERSION__";

function readPackageVersion(): string | undefined {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" && pkg.version ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

export const PKG_VERSION =
  envGet("npm_package_version") ||
  (BUILD_VERSION !== "__PKG_VERSION__" ? BUILD_VERSION : undefined) ||
  readPackageVersion() ||
  "0.0.0";
