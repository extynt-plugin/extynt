#!/usr/bin/env node
// Lints every maintained file, or only those matching --paths, with the repository ESLint configuration.
import { spawnSync } from "node:child_process";
import { pathGlobs, pathScope } from "./lib/path-filter.ts";
import { ROOT, maintainedFiles, rel } from "./lib/sources.ts";

const keep = pathScope(pathGlobs(process.argv.slice(2)));
const files = maintainedFiles().map(rel).filter(keep).sort();
const result = files.length ? spawnSync("pnpm", ["exec", "eslint", "--flag", "unstable_native_nodejs_ts_config", ...files], { cwd: ROOT, stdio: "inherit" }) : { status: 0 };
process.exit(result.status ?? 1);
