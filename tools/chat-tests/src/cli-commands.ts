/** The chat-tests commands that do not run a scenario: `list`, `profile`, `ledger` and `corpus`. */
import { join } from "node:path";
import { COMPOSITION_ASSETS } from "./assets.js";
import { ledgerSummary, readLedger } from "./benchmark-ledger.js";
import type { CliArgs } from "./cli-args.js";
import { readBenchmarkProjectManifest } from "./corpus.js";
import { realProfileDirectory } from "./host-profile.js";
import { deriveHostProfile, type DerivedProfile } from "./profile-fixture.js";
import { readFontCensus, readLiveReports } from "./profile-reports.js";
import { PROMPTS_DIRECTORY, loadPrompts } from "./prompts.js";
import { REPO_ROOT } from "./repo-root.js";
import { SCENARIOS } from "./scenarios.js";

/** What a command hands back: an exit code, or a request to print the help text. */
export type CommandResult = number | "usage";

const say = (text: string): void => { process.stdout.write(text); };

/** Prints the assets, the prompt library and the scenarios defined in code. */
export function listCommand(): number {
  say("Assets:\n");
  for (const asset of Object.values(COMPOSITION_ASSETS)) say(`  ${asset.id.padEnd(16)} ${asset.description}\n`);
  const prompts = loadPrompts();
  say(`\nPrompts (${PROMPTS_DIRECTORY}):\n`);
  if (!prompts.length) say("  (none — add a markdown file to the directory above)\n");
  for (const prompt of prompts) {
    const firstLine = prompt.scenario.message.split("\n")[0] ?? "";
    say(`  ${prompt.scenario.id.padEnd(28)} ${prompt.scenario.asset.padEnd(14)} ${firstLine.slice(0, 56)}…\n`);
  }
  say("\nScenarios defined in code:\n");
  for (const scenario of SCENARIOS.filter((entry) => !prompts.some((prompt) => prompt.scenario.id === entry.id))) {
    say(`  ${scenario.id.padEnd(28)} ${scenario.offline ? "offline" : "live   "}  ${scenario.asset.padEnd(14)} ${scenario.message.slice(0, 56)}${scenario.message.length > 56 ? "…" : ""}\n`);
  }
  say("\nLive scenarios need a model: run with --live (the provider is read from the repo .env).\n");
  return 0;
}

function describeDerived(derived: DerivedProfile, fontsPath: string | undefined, fontSource: string | undefined): void {
  say(`Derived a host profile for ${derived.hostKey} from ${derived.reports.length} live report(s).\n`);
  say(`  effects proven applied: ${derived.proven}\n  of ${derived.total} in the base profile; ${derived.available} now available\n`);
  if (derived.assumed) say(`  ${derived.assumed} marked installed on your instruction (--assume-installed), not by evidence\n`);
  if (derived.cleared) say(`  ${derived.cleared} left unknown: the base called them unavailable, but its census was not authoritative\n`);
  if (derived.seededFonts) say(`  ${derived.seededFonts} font(s) seeded from ${fontsPath}${fontSource ? ` (a measured census: ${fontSource})` : " (hand-written: plausible names, not a measured census)"}\n`);
  say(`  written to ${derived.directory}\n`);
  if (derived.note) say(`NOTE: ${derived.note}\n`);
  say(`Use it with: --profile ${derived.directory}\n`);
}

/** Derives a host profile from the live verification reports. */
export function profileCommand(args: CliArgs): number {
  const out = args.valueOf("--out");
  if (!out) {
    say("profile needs --out <dir>, outside the repository: a profile derived from live reports is real host data and must never overwrite the tracked synthetic fixtures.\n");
    return 2;
  }
  const from = args.valueOf("--from") ?? join(REPO_ROOT, "docs/live-reports");
  const reports = readLiveReports(from);
  if (!reports.length) {
    say(`No live reports found under ${from}. Pass --from <dir> pointing at a live-reports directory.\n`);
    return 2;
  }
  const fontsPath = args.valueOf("--fonts");
  const fonts = fontsPath ? readFontCensus(fontsPath) : undefined;
  const derived = deriveHostProfile({ base: args.valueOf("--base") ?? realProfileDirectory(), out, reports, assumeInstalled: args.hasFlag("--assume-installed"), fonts });
  describeDerived(derived, fontsPath, fonts?.source);
  return 0;
}

/** Summarizes a benchmark ledger. */
export function ledgerCommand(args: CliArgs): CommandResult {
  const path = args.rest.find((argument) => !argument.startsWith("--"));
  if (!path) return "usage";
  say(`${ledgerSummary(readLedger(path))}\n`);
  return 0;
}

/** Validates and summarizes a real-project manifest. */
export function corpusCommand(args: CliArgs): CommandResult {
  const path = args.rest.find((argument) => !argument.startsWith("--"));
  if (!path) return "usage";
  const manifest = readBenchmarkProjectManifest(path);
  say(`${manifest.id}: ${manifest.scenarios.length} scenario(s), ${manifest.requirements.plugins.length} plugin requirement(s), distribution=${manifest.source.distribution}, approvedForCommit=${manifest.review.approvedForCommit}\n`);
  return 0;
}
