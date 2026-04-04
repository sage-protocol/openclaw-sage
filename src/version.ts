import { envGet } from "./runtime.js";

export const PKG_VERSION = envGet("npm_package_version") || "__PKG_VERSION__";
