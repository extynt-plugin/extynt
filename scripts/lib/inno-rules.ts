// Gate rules for Inno Setup scripts (.iss): the comment policy and the size limits, applied to the [Code] routines.
import { blockFailure, groupBlocks } from "./comments/comment-blocks.ts";
import type { SourceComment } from "./comments/comment-blocks.ts";
import { scanInno } from "./inno-lexer.ts";
import { MAX_COMPLEXITY, MAX_FILE_LINES, MAX_FUNCTION_LINES, MAX_NESTING, MAX_PARAMS } from "./measure.ts";

interface Routine {
  readonly name: string;
  readonly first: number;
  readonly last: number;
}

const ROUTINE = /^(?:function|procedure)\s+(\w+)/i;
const ROUTINE_END = /^end;/i;
const BRANCH = /\b(?:if|while|for|until|and|or|except|case)\b/gi;
const BLOCK_WORD = /\b(?:begin|try|repeat|case|end|until)\b/gi;
const OPENERS = new Set(["begin", "try", "repeat", "case"]);
const MISSING_HEADER = "the file must open with one header comment (what the installer is and how it is built)";
const MISPLACED = "a comment belongs in the header or directly above a routine, never in a section or a body";

function firstCodeLine(codeLines: ReadonlySet<number>): number {
  return Math.min(...codeLines);
}

/** The header comment of an .iss file: its first comment block, when it starts before the first directive or entry. */
export function innoHeaderBlock(text: string): SourceComment | undefined {
  const { comments, codeLines } = scanInno(text);
  const [first] = groupBlocks(comments);
  return first !== undefined && first.line < firstCodeLine(codeLines) ? first : undefined;
}

function routinesOf(masked: ReadonlyArray<string>): Routine[] {
  const found: Routine[] = [];
  let open: { name: string; first: number } | undefined;
  masked.forEach((line, index) => {
    const start = open ? null : ROUTINE.exec(line);
    if (start?.[1]) open = { name: start[1], first: index + 1 };
    else if (open && ROUTINE_END.test(line)) {
      found.push({ ...open, last: index + 1 });
      open = undefined;
    }
  });
  return found;
}

function routineLines(masked: ReadonlyArray<string>, routine: Routine): string[] {
  return masked.slice(routine.first - 1, routine.last);
}

function documentedRoutineLines(masked: ReadonlyArray<string>): Set<number> {
  return new Set(routinesOf(masked).map((routine) => routine.first));
}

/** Comment-policy failures for an .iss file: a header block, then comments only directly above a [Code] routine. */
export function innoCommentFailures(key: string, text: string): string[] {
  const { comments, codeLines, masked } = scanInno(text);
  const blocks = groupBlocks(comments);
  const header = blocks[0] !== undefined && blocks[0].line < firstCodeLine(codeLines);
  const documented = documentedRoutineLines(masked);
  const failures = header ? [] : [`${key}:1: ${MISSING_HEADER}`];
  const rest = header ? blocks.slice(1) : blocks;
  return [...failures, ...rest.filter((block) => !(block.ownLine && documented.has(block.endLine + 1))).map((block) => blockFailure(key, block, MISPLACED))];
}

function parameterCount(body: string): number {
  const list = /^(?:function|procedure)\s+\w+\s*\(([^)]*)\)/i.exec(body)?.[1] ?? "";
  const groups = list.split(";").filter((group) => group.trim() !== "");
  return groups.reduce((total, group) => total + (group.split(":")[0] ?? "").split(",").length, 0);
}

function nestingDepth(body: string): number {
  let depth = 0;
  let deepest = 0;
  for (const word of body.match(BLOCK_WORD) ?? []) {
    depth += OPENERS.has(word.toLowerCase()) ? 1 : -1;
    deepest = Math.max(deepest, depth);
  }
  return Math.max(0, deepest - 1);
}

function routineFailures(key: string, routine: Routine, lines: ReadonlyArray<string>): string[] {
  const body = lines.join("\n");
  const where = `${key}:${routine.first} ${routine.name}`;
  const nloc = lines.filter((line) => line.trim() !== "").length;
  const complexity = 1 + (body.match(BRANCH)?.length ?? 0);
  const failures: string[] = [];
  if (nloc > MAX_FUNCTION_LINES) failures.push(`${where} has ${nloc} NLOC > ${MAX_FUNCTION_LINES}`);
  if (complexity > MAX_COMPLEXITY) failures.push(`${where} complexity ${complexity} > ${MAX_COMPLEXITY}`);
  if (nestingDepth(body) > MAX_NESTING) failures.push(`${where} nests ${nestingDepth(body)} deep > ${MAX_NESTING}`);
  if (parameterCount(body) > MAX_PARAMS) failures.push(`${where} has ${parameterCount(body)} parameters; pass one record`);
  return failures;
}

/** Size failures for an .iss file: its length, and each [Code] routine's length, complexity, nesting and parameters. */
export function innoMetricFailures(key: string, text: string): string[] {
  const { codeLines, masked } = scanInno(text);
  const length = codeLines.size > MAX_FILE_LINES ? [`${key}: ${codeLines.size} NLOC > ${MAX_FILE_LINES}`] : [];
  return [...length, ...routinesOf(masked).flatMap((routine) => routineFailures(key, routine, routineLines(masked, routine)))];
}
