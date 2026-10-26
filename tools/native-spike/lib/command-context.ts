/** What every command of the native-spike command line receives: its options, positionals and streams. */
import type { CliOptions } from "./args.ts";
import type { Io } from "./output.ts";

/** The parsed command line together with the streams and environment a command runs against. */
export interface CommandContext {
  readonly options: CliOptions;
  readonly positionals: ReadonlyArray<string>;
  readonly io: Io;
  readonly env: Io["env"];
}
