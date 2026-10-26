// The unused-locals half of the dead-exports stage: a local, import or type parameter nothing reads, counted per area from one tsc pass.
import { areaOf } from "./areas.ts";
import { runCommand } from "./stage-runner.ts";
import { writeStrictLayer } from "./strict-projects.ts";

/** One unused local, import or type parameter: where it is, which area owns it, and what tsc said. */
export interface UnusedDeclaration {
  readonly file: string;
  readonly line: number;
  readonly area: string;
  readonly message: string;
}

/** The number of unused declarations in one area. */
export interface AreaCount {
  readonly area: string;
  readonly count: number;
}

/** What the stage reports: the failing declarations and a one-line summary of the rest. */
export interface UnusedVerdict {
  readonly failures: string[];
  readonly summary: string;
}

const UNUSED_LINE = /^(\S[^(]*)\((\d+),\d+\): error (TS6133|TS6192|TS6196|TS6198|TS6199|TS6205): (.*)$/;

/**
 * The areas whose unused-local count is 0 today (every area).  A new unused local or import in one of them fails the stage; the other areas only report
 * their count, until a sweep brings them to 0 and adds them here.
 */
export const CLEAN_AREAS: ReadonlySet<string> = new Set([
  "apps/sidecar", "apps/panel/runtime", "apps/panel/tests", "packages/action-plan", "packages/capability-catalogue", "packages/collection",
  "packages/decide", "packages/decode", "packages/host-ae", "packages/host-native", "packages/llm", "packages/mcp-server",
  "packages/project-graph", "packages/visual-evidence", "packages/workflow", "tools/chat-tests", "tools/fake-plugin",
  "tools/host-verification", "tools/native-spike", "scripts", "tests", "other",
]);

/** [{ file, line, area, message }] for the unused-declaration errors in tsc output. */
export function unusedDeclarations(output: string): UnusedDeclaration[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = UNUSED_LINE.exec(line);
    if (!match) return [];
    const [, path = "", lineNumber = "", , message = ""] = match;
    const file = path.replaceAll("\\", "/");
    return [{ file, line: Number(lineNumber), area: areaOf(file), message }];
  });
}

/** [{ area, count }] by descending count. */
export function countsByArea(declarations: ReadonlyArray<UnusedDeclaration>): AreaCount[] {
  const counts = new Map<string, number>();
  for (const { area } of declarations) counts.set(area, (counts.get(area) ?? 0) + 1);
  return [...counts].map(([area, count]) => ({ area, count })).sort((left, right) => right.count - left.count);
}

/** Runs one tsc pass with noUnusedLocals over every project and returns its unused declarations whose file `keep` accepts. */
export async function unusedLocals(keep: (file: string) => boolean): Promise<UnusedDeclaration[]> {
  const root = writeStrictLayer(undefined, { layer: "unused", extraOptions: { noUnusedLocals: true } });
  const result = await runCommand({ command: "pnpm", args: ["exec", "tsc", "-b", root, "--pretty", "false"], label: "unused-locals" });
  return unusedDeclarations(result.output).filter((entry) => keep(entry.file));
}

/** { failures, summary }: failures are the declarations in clean areas, summary the per-area counts of the rest. */
export function unusedLocalVerdict(declarations: ReadonlyArray<UnusedDeclaration>, cleanAreas: ReadonlySet<string> = CLEAN_AREAS): UnusedVerdict {
  const failures = declarations.filter((entry) => cleanAreas.has(entry.area)).map((entry) => `${entry.file}:${entry.line}: unused local or import: ${entry.message}`);
  const counts = countsByArea(declarations.filter((entry) => !cleanAreas.has(entry.area)));
  const summary = counts.length ? `unused locals (warning): ${counts.map((row) => `${row.area}=${row.count}`).join(" ")}` : "unused locals: 0";
  return { failures, summary };
}
