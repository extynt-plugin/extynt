/** Entry point of the native-spike command line. */
import { parseCli } from "./args.ts";
import type { Command } from "./args.ts";
import { benchCommand } from "./cmd-bench.ts";
import { compareCommand } from "./cmd-compare.ts";
import { dumpCommand } from "./cmd-dump.ts";
import type { CommandContext } from "./command-context.ts";
import { describeError, exitCodeOf } from "./errors.ts";
import { USAGE } from "./help.ts";
import type { Io } from "./output.ts";

const COMMANDS: Readonly<Record<Command, (context: CommandContext) => Promise<number>>> = {
  bench: benchCommand,
  compare: compareCommand,
  dump: dumpCommand,
};

/** Runs the CLI against injectable streams and environment; resolves to the process exit code. */
export async function main(argv: ReadonlyArray<string>, io: Io = { stdout: process.stdout, stderr: process.stderr, env: process.env }): Promise<number> {
  try {
    const { command, options, positionals } = parseCli(argv);
    if (options.help) { io.stdout.write(USAGE); return 0; }
    return await COMMANDS[command]({ options, positionals, io, env: io.env });
  } catch (error) {
    const failure = error instanceof Error ? error : String(error);
    io.stderr.write(`${describeError(failure)}\n`);
    return exitCodeOf(failure);
  }
}
