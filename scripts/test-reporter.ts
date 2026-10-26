// Failures-only reporter for `node --test`.  A green run prints one summary
// line; a red run prints each failure's message and stack, then a recap naming
// every failing test.  Passing tests and their output never reach the log, so
// agent transcripts stay proportional to the defects, not to the suite size.

import { Transform } from "node:stream";
import type { TransformCallback, TransformOptions } from "node:stream";
import type { TestEvent } from "node:test/reporters";
import { decode, fallback, number, object, optional, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";

type EventOf<Type extends TestEvent["type"]> = Extract<TestEvent, { type: Type }>["data"];

interface Located {
  readonly name: string;
  readonly file?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
}

interface ErrorParts {
  readonly name: string | undefined;
  readonly code: string | undefined;
  readonly message: string | undefined;
  readonly stack: string | undefined;
}

interface Described {
  readonly heading: string;
  readonly frames: string[];
}

interface Failure {
  readonly name: string;
  readonly where: string;
  readonly lines: string[];
}

const ROLLUP_FAILURE = /^\d+ subtest(s)? failed$/;
const WRAPPER_PREFIX = /^\w+(?: \[\w+\])?: /;
const FRAME = /^\s+at /;
const INTERNAL_FRAME = /node:(?:internal|test|async_hooks)\b/;
const DURATION = /^duration_ms ([\d.]+)$/;

const summaryCounts = object({
  tests: number(),
  passed: number(),
  failed: number(),
  skipped: fallback(number(), 0),
  todo: fallback(number(), 0),
});
const plainError = object({
  name: optional(fallback(string(), undefined)),
  code: optional(fallback(string(), undefined)),
  message: optional(fallback(string(), undefined)),
  stack: optional(fallback(string(), undefined)),
});

type SummaryCounts = Infer<typeof summaryCounts>;

function text(value: string | undefined, fallbackText: string): string {
  return typeof value === "string" && value.length ? value : fallbackText;
}

function frames(stack: string | undefined): string[] {
  return (stack ?? "").split("\n").filter((line) => FRAME.test(line) && !INTERNAL_FRAME.test(line));
}

function describe(error: ErrorParts): Described {
  const name = text(error.name, "Error");
  const code = text(error.code, "");
  const message = text(error.message, "(no message)");
  return { heading: `${name}${code ? ` [${code}]` : ""}: ${message}`, frames: frames(error.stack) };
}

function partsOfError(error: Error): ErrorParts {
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return { name: error.name, code, message: error.message, stack: error.stack };
}

function partsOfCause(cause: Error["cause"]): ErrorParts | undefined {
  if (cause instanceof Error) return partsOfError(cause);
  const decoded = decode(plainError, cause);
  return decoded.ok ? { name: decoded.value.name, code: decoded.value.code, message: decoded.value.message, stack: decoded.value.stack } : undefined;
}

function failureOf(data: EventOf<"test:fail">): Described {
  const wrapper = data.details.error;
  return describe(partsOfCause(wrapper.cause) ?? partsOfError(wrapper));
}

function location(data: Located): string {
  const file = text(data.file, "");
  const short = file.split("/").pop();
  return short && typeof data.line === "number" ? `${short}:${data.line}:${data.column ?? 1}` : short || "unknown file";
}

function durationText(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function clampLines(value: string, limit: number): string[] {
  const lines = value.split("\n");
  return lines.length > limit ? [...lines.slice(0, limit), `    ... ${lines.length - limit} more lines`] : lines;
}

function failureBlock(data: Located, described: Described): string[] {
  const body = clampLines(described.heading, 30).map((line) => `    ${line}`);
  const stack = described.frames.slice(0, 5).map((line) => `  ${line.trim()}`);
  return [`\n✖ ${location(data)}  ${text(data.name, "(unnamed test)")}`, ...body, ...stack];
}

export default class FailuresOnlyReporter extends Transform {
  #counts: SummaryCounts | null = null;
  #durationMs: number | null = null;
  #failures: Failure[] = [];
  #skips: EventOf<"test:pass">[] = [];
  #captured: string[] = [];

  constructor(options?: TransformOptions) {
    super({ ...options, writableObjectMode: true });
  }

  override _transform(event: TestEvent, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.#record(event);
    callback();
  }

  #record(event: TestEvent): void {
    switch (event.type) {
      case "test:fail": return this.#recordFailure(event.data);
      case "test:pass": return this.#recordPass(event.data);
      case "test:summary": return this.#recordSummary(event.data);
      case "test:diagnostic": return this.#recordDiagnostic(event.data);
      case "test:stdout":
      case "test:stderr": return this.#recordOutput(event.data);
      default:
    }
  }

  #recordFailure(data: EventOf<"test:fail">): void {
    const described = failureOf(data);
    if (ROLLUP_FAILURE.test(described.heading.replace(WRAPPER_PREFIX, ""))) return;
    const name = text(data.name, "(unnamed test)");
    this.#failures.push({ name, where: location(data), lines: failureBlock(data, described) });
  }

  #recordPass(data: EventOf<"test:pass">): void {
    if (data.skip || data.todo) this.#skips.push(data);
  }

  #recordSummary(data: EventOf<"test:summary">): void {
    const decoded = decode(summaryCounts, data.counts);
    if (decoded.ok) this.#counts = decoded.value;
  }

  #recordDiagnostic(data: EventOf<"test:diagnostic">): void {
    const duration = DURATION.exec(data.message);
    if (duration) this.#durationMs = Number(duration[1]);
  }

  #recordOutput(data: EventOf<"test:stdout">): void {
    this.#captured.push(data.message);
  }

  #skipLines(): string[] {
    return this.#skips.map((data) => `SKIP ${location(data)}  ${text(data.name, "(unnamed test)")}${data.skip ? ` — ${data.skip}` : " (todo)"}`);
  }

  #summaryLines(): string[] {
    const counts = this.#counts ?? { tests: this.#failures.length, passed: 0, failed: this.#failures.length, skipped: 0, todo: 0 };
    const duration = this.#durationMs === null ? "" : ` duration=${durationText(this.#durationMs)}`;
    const line = `tests=${counts.tests} pass=${counts.passed} fail=${counts.failed} skipped=${counts.skipped} todo=${counts.todo}${duration}`;
    if (!counts.failed) return [`\n${line}\n`];
    const recap = this.#failures.map((failure) => `${failure.where} "${failure.name}"`).join("; ");
    return [`\n${line}`, `FAILED: ${recap}\n`];
  }

  override _flush(callback: TransformCallback): void {
    const parts: string[] = [];
    if (this.#skips.length) parts.push(...this.#skipLines(), "");
    for (const failure of this.#failures) parts.push(...failure.lines);
    if (this.#failures.length && this.#captured.length) parts.push("\n--- captured test output ---", ...this.#captured);
    parts.push(...this.#summaryLines());
    callback(null, parts.join("\n"));
  }
}
