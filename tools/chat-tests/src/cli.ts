#!/usr/bin/env node
/**
 * chat-tests CLI: `list`, `run` (did it do the right thing) and `trace` (why did it do that).
 * Only `trace` starts the sidecar in-process, because a transcript needs the provider itself.
 * Prompts live in `prompts/*.md` as prose with a few front-matter fields, so adding one needs
 * no code; `list` shows what was loaded and from where.
 */
import { parseArgs, type CliArgs } from "./cli-args.js";
import { corpusCommand, ledgerCommand, listCommand, profileCommand, type CommandResult } from "./cli-commands.js";
import { runCommand } from "./cli-run.js";
import { usageText } from "./cli-usage.js";

function dispatch(args: CliArgs): CommandResult | Promise<CommandResult> {
  switch (args.command) {
    case "list": return listCommand();
    case "profile": return profileCommand(args);
    case "ledger": return ledgerCommand(args);
    case "corpus": return corpusCommand(args);
    case "run":
    case "trace": return runCommand(args);
    default: return "usage";
  }
}

const args = parseArgs(process.argv.slice(2));
const result = !args.command || args.command === "help" || args.hasFlag("--help") ? "usage" : await dispatch(args);
if (result === "usage") process.stdout.write(usageText());
await new Promise<void>((resolve) => { process.stdout.write("", () => resolve()); });
process.exit(result === "usage" ? 0 : result);
