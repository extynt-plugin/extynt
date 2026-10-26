#!/usr/bin/env node
// The single list of places that carry the product version, shared by bump-version.ts and the version-consistency test.
// Run directly it prints one line per owned place that disagrees with the root package.json version and exits 1 if any do.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeOrThrow, object, string } from "@extynt/decode";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const EVIDENCE_TEST = "packages/capability-catalogue/tests/stale-evidence.test.ts";
const WORKSPACE_GROUPS = ["apps", "packages", "tools"];
const JSON_VERSION = /^(\s*"version":\s*")([^"]*)(")/m;
const constant = (name: string): RegExp => new RegExp(`(export const ${name} = ")([^"]*)(")`);
const numericCore = (version: string): string => /^\d+\.\d+\.\d+/.exec(version)?.[0] ?? version;
const same = (version: string): string => version;
const PACKAGE_VERSION = object({ version: string() });

/** A file that holds the version: `pattern` captures (prefix)(version)(suffix); `value` maps the product version to what the file holds. */
export interface OwnedPlace {
  readonly file: string;
  readonly pattern: RegExp;
  readonly value: (version: string) => string;
  readonly generated: boolean;
}

function workspacePackages(): string[] {
  return WORKSPACE_GROUPS.flatMap((group) => readdirSync(join(REPO_ROOT, group))
    .map((name) => `${group}/${name}/package.json`)
    .filter((file) => existsSync(join(REPO_ROOT, file))));
}

/** Every place whose text holds the version: `pattern` captures (prefix)(version)(suffix) and `value` maps the product version to what the place holds. */
export function ownedPlaces(): OwnedPlace[] {
  const place = (file: string, pattern: RegExp, value = same, generated = false): OwnedPlace => ({ file, pattern, value, generated });
  return [
    place("package.json", JSON_VERSION),
    ...workspacePackages().map((file) => place(file, JSON_VERSION)),
    place("plugin/.claude-plugin/plugin.json", JSON_VERSION),
    place("plugin/.codex-plugin/plugin.json", JSON_VERSION),
    place("apps/sidecar/src/server-contracts.ts", constant("SIDECAR_VERSION")),
    place("packages/mcp-server/src/version.ts", constant("MCP_SERVER_VERSION")),
    place("packages/capability-catalogue/src/verification.ts", constant("EVIDENCE_PRODUCT_VERSION")),
    place("native/extynt-core/CMakeLists.txt", /(project\(extynt_core VERSION )([^ )]*)( )/, numericCore),
    place("native/extynt-core/CMakeLists.txt", /(set\(EXTYNT_PLUGIN_VERSION ")([^"]*)(")/),
    place("native/extynt-core/build-mac.sh", /(EXTYNT_PLUGIN_VERSION:-)([^}]*)(\})/),
    place("native/extynt-core/build-win.ps1", /(else \{ ')([^']*)(' \})/),
    place(EVIDENCE_TEST, /(\[")([^"]*)(", false\])/, same, true),
  ];
}

export function productVersion(): string {
  return decodeOrThrow(PACKAGE_VERSION, JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"))).version;
}

/** One message per owned place whose version is not the one the root package.json says. */
export function versionMismatches(expected = productVersion()): string[] {
  return ownedPlaces().flatMap(({ file, pattern, value }) => {
    const found = pattern.exec(readFileSync(join(REPO_ROOT, file), "utf8"));
    if (!found) return [`${file}: version not found`];
    return found[2] === value(expected) ? [] : [`${file}: ${found[2]} != ${value(expected)}`];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mismatches = versionMismatches();
  if (mismatches.length) console.log(mismatches.join("\n"));
  process.exitCode = mismatches.length ? 1 : 0;
}
