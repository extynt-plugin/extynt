/** The help text of the chat-tests command line. */
import { PROMPTS_DIRECTORY } from "./prompts.js";

const COMMAND_LINES = [
  "chat-tests — drive the in-panel agent through realistic composition requests",
  "",
  "  list                                  show assets, prompts, and scenarios",
  "  run [options]                         run scenarios and report pass/fail",
  "  trace [options]                       run scenarios and print the full turn",
  "  profile                               derive a host profile from the live verification reports",
  "  ledger <file>                         inspect an existing benchmark JSONL ledger",
  "  corpus <manifest>                     validate and summarize a real-project manifest",
  "",
  "Options",
  "  --live                use the model configured in the repo .env instead of the mock provider",
  "  --model <id>          override the model for a live run (e.g. deepseek-v4-pro); needs --live",
  "  --scenario <id>       run one scenario (repeatable)",
  "  --json                print the raw run records instead of a transcript",
  "  --quiet               only print failures",
  "  --watch               narrate each turn as it happens, step by step",
  "  --fake-host           serve the fixture project through the fake plugin and let the sidecar apply what it seals;",
  "                        receipts are verified against the fixture's own read-back, never real After Effects",
  "  --plugin-endpoint <native.json>",
  "                        talk to an already-running real extynt plugin (e.g. After Effects reached over a forwarded port)",
  "                        instead of the fake plugin; applies what the turn seals; fixture-only checks are skipped",
  "  --fixture-readback    accepted for compatibility: --fake-host always verifies against the fixture read-back",
  "  --full-prompt         trace: print the whole system briefing (default: a preview)",
  "  --profile <dir>       use the host capability profile from <dir> instead of this machine's",
  "  --timeout <seconds>   how long one turn may take (default 600 live, 30 mock)",
  "  --no-trace            do not save the JSONL trace of this run (by default every scenario's trace is saved)",
  "  --trace-dir <dir>     where traces are saved (default: tools/chat-tests/traces, which git ignores)",
] as const;

const PROFILE_LINES = [
  "  --base <dir>          profile: the profile to upgrade (default: this machine's)",
  "  --assume-installed    profile: mark every curated effect installed. A real After",
  "                        Effects ships them all, so this is what a host profile",
  "                        derived from a partial verification matrix needs to stop",
  "                        refusing work over an inventory gap. Recorded per entry.",
  "  --fonts <file>        profile: seed the font census from a JSON file of",
  "                        {family,style,postScriptName} records, so the agent's font",
  "                        path can be exercised without a host. Reported as seeded.",
  "  --from <dir>          profile: where the live reports live (default: docs/live-reports)",
  "  --out <file>          trace: write the readable transcript; profile: the output directory (required, outside the repo)",
  "  --jsonl <file>        trace: write the per-scenario summary records here",
  "  --ledger <file>       append one privacy-bounded benchmark row per scenario",
] as const;

/** The full help text. */
export function usageText(): string {
  return [
    ...COMMAND_LINES,
    ...PROFILE_LINES,
    "",
    `Prompts: add a markdown file to ${PROMPTS_DIRECTORY}`,
    "  front matter (---) with id, asset, and optional offline/notes/expect, then the",
    "  prompt verbatim. No rebuild and no code change needed to add one.",
    "",
    "Live scenarios are skipped, not silently dropped, when no model is configured.",
    "Model names are not all distinct: the API echoes back the canonical id, so",
    "\"deepseek-v4-flash\" and \"deepseek-chat\" both resolve to \"deepseek-flash\".",
    "",
  ].join("\n");
}
