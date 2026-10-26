/** An error the CLI can explain to its operator; exitCode 2 means a connection or usage problem. */
import { decode, object, string } from "@extynt/decode";

const CODED = object({ code: string() });

/** The error that explains itself to the operator and carries the process exit code. */
export class SpikeError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 2) {
    super(message);
    this.name = "SpikeError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

/** The one-line explanation printed for a failure; a stack for anything that is not a SpikeError. */
export function describeError(error: Error | string): string {
  if (error instanceof SpikeError) return `error [${error.code}]: ${error.message}`;
  return `unexpected error: ${error instanceof Error ? error.stack : error}`;
}

/** The process exit code of a failure: the SpikeError's own, otherwise 2. */
export function exitCodeOf(error: Error | string): number {
  return error instanceof SpikeError ? error.exitCode : 2;
}

/** The machine code an operating-system error carries (`ENOENT`, `ECONNREFUSED`), or undefined. */
export function systemCode(error: Error): string | undefined {
  const decoded = decode(CODED, error);
  return decoded.ok ? decoded.value.code : undefined;
}
