/** Writes command output to stdout and stderr. */
import { writeFileSync } from "node:fs";

/** Something text can be written to: a stream, or a collector in a test. */
export interface TextSink {
  readonly write: (text: string) => void;
}

/** The streams and environment a command runs against. */
export interface Io {
  readonly stdout: TextSink;
  readonly stderr: TextSink;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** The output options and streams `emit` needs. */
export interface EmitTarget {
  readonly options: { readonly out: string | undefined; readonly json: boolean };
  readonly io: Pick<Io, "stdout" | "stderr">;
}

/** Human text goes to stdout, or to stderr when --json claims stdout for the machine-readable result. */
export function emit<Result>({ options, io }: EmitTarget, result: Result, humanText: string): void {
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.out) writeFileSync(options.out, json);
  if (options.json) {
    io.stderr.write(`${humanText}\n`);
    io.stdout.write(json);
  } else {
    io.stdout.write(`${humanText}\n`);
  }
}
