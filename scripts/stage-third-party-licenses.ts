#!/usr/bin/env node
// node scripts/stage-third-party-licenses.ts --bundle <dir> --node-license <file>
// Stages NOTICE and licenses/ into a payload directory (see scripts/lib/third-party-licenses.ts); used by
// scripts/build-mac-bundle.sh. The Windows bundle calls the same function from scripts/build-win-bundle.ts.
import { resolve } from "node:path";
import { ROOT } from "./lib/sources.ts";
import { stageThirdPartyLicenses } from "./lib/third-party-licenses.ts";

const args = process.argv.slice(2);
const options = { bundle: "", nodeLicense: "" };
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--bundle") options.bundle = resolve(args[++index] ?? "");
  else if (args[index] === "--node-license") options.nodeLicense = resolve(args[++index] ?? "");
  else { console.error(`stage-third-party-licenses: unrecognized argument ${args[index]}`); process.exit(1); }
}
if (!options.bundle || !options.nodeLicense) {
  console.error("usage: node scripts/stage-third-party-licenses.ts --bundle <dir> --node-license <file>");
  process.exit(1);
}
try {
  stageThirdPartyLicenses(ROOT, options.bundle, options.nodeLicense);
  console.log(`staged NOTICE and licenses/ into ${options.bundle}`);
} catch (error) {
  console.error(`stage-third-party-licenses: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
