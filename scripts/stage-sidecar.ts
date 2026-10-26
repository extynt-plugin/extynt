#!/usr/bin/env node
// node scripts/stage-sidecar.ts --bundle <dir>
// Stages the built sidecar into <dir>/sidecar as an explicit allowlist (apps/sidecar and each workspace package: package.json
// plus dist/src, no declarations, maps or tests), the same staging the Windows bundle uses; used by scripts/build-mac-bundle.sh.
import { resolve } from "node:path";
import { ROOT } from "./lib/sources.ts";
import { stageSidecar } from "./lib/win-bundle-stage.ts";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--bundle") {
  console.error("usage: node scripts/stage-sidecar.ts --bundle <dir>");
  process.exit(1);
}
try {
  stageSidecar(ROOT, resolve(args[1] ?? ""));
  console.log(`staged sidecar/ into ${resolve(args[1] ?? "")}`);
} catch (error) {
  console.error(`stage-sidecar: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
