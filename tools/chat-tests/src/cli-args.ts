/** The command line, split into the command, its flags and its values. */

/** A parsed command line. */
export interface CliArgs {
  command: string | undefined;
  rest: readonly string[];
  flags: ReadonlySet<string>;
  scenarioIds: readonly string[];
  valueOf(name: string): string | undefined;
  hasFlag(name: string): boolean;
}

/** Splits `argv` (without the node and script paths) into a command and its options. */
export function parseArgs(argv: readonly string[]): CliArgs {
  const [command, ...rest] = argv;
  const flags = new Set(rest.filter((argument) => argument.startsWith("--")));
  const scenarioIds: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index + 1];
    if (rest[index] === "--scenario" && value) scenarioIds.push(value);
  }
  const valueOf = (name: string): string | undefined => {
    const at = rest.indexOf(name);
    const next = at >= 0 ? rest[at + 1] : undefined;
    return next && !next.startsWith("--") ? next : undefined;
  };
  return { command, rest, flags, scenarioIds, valueOf, hasFlag: (name) => flags.has(name) };
}
