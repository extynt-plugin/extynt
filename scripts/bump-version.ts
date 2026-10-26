#!/usr/bin/env node
// The only way the product version changes: `node scripts/bump-version.ts <version> [--dry-run]` rewrites every place
// scripts/version-metadata.ts lists (the native plugin version follows the product version) and then rebuilds the panel bundle.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { EVIDENCE_TEST, REPO_ROOT, ownedPlaces, productVersion, versionMismatches } from "./version-metadata.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function requestedVersion(): string {
  const candidate = args.find((arg) => !arg.startsWith("--"));
  if (candidate && /^\d+\.\d+\.\d+[a-z]?$/.test(candidate)) return candidate;
  console.error("Usage: node scripts/bump-version.ts <new-version, e.g. 0.2.0> [--dry-run]");
  process.exit(1);
}

const newVersion = requestedVersion();

const currentVersion = productVersion();
console.log(`Bumping version from ${currentVersion} to ${newVersion}${dryRun ? " (dry-run)" : ""}`);

const evidenceRow = (version: string, stale: boolean): string => `  ["${version}", ${stale}], ["${version}+matrix.42", ${stale}],`;

function bumpEvidenceRows(text: string): string {
  const next = text.replace(evidenceRow(currentVersion, false), evidenceRow(currentVersion, true));
  if (next.includes(evidenceRow(newVersion, true))) return next.replace(evidenceRow(newVersion, true), evidenceRow(newVersion, false));
  return next.replace(evidenceRow(currentVersion, true), `${evidenceRow(currentVersion, true)}\n${evidenceRow(newVersion, false)}`);
}

const contents = new Map<string, string>();
const read = (file: string): string => contents.get(file) ?? readFileSync(join(REPO_ROOT, file), "utf8");

function rewriteOwnedPlaces(): void {
  for (const { file, pattern, value, generated } of ownedPlaces()) {
    if (generated) continue;
    const text = read(file);
    if (!pattern.test(text)) throw new Error(`${file}: version not found`);
    contents.set(file, text.replace(pattern, `$1${value(newVersion)}$3`));
    console.log(`Updated ${file}`);
  }
  contents.set(EVIDENCE_TEST, bumpEvidenceRows(read(EVIDENCE_TEST)));
  console.log(`Updated ${EVIDENCE_TEST}`);
}

function rebuildAndVerify(): void {
  for (const [file, text] of contents) writeFileSync(join(REPO_ROOT, file), text);
  const build = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "build-panel.ts")], { cwd: REPO_ROOT, stdio: "inherit" });
  if (build.status !== 0) throw new Error("build-panel.ts failed; run it again before testing");
  const mismatches = versionMismatches(newVersion);
  if (mismatches.length) throw new Error(`Version places still disagree:\n${mismatches.join("\n")}`);
  console.log(`\nAll version places now say ${newVersion}.`);
}

rewriteOwnedPlaces();
if (dryRun) {
  console.log("\nThis was a dry-run. No files were modified.");
  process.exit(0);
}
rebuildAndVerify();
