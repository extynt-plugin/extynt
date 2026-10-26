// Finds the comments of a bash or sh script, skipping quotes, expansions and heredoc bodies.
import type { ScriptScan, SourceComment } from "./comment-blocks.ts";

interface Heredoc {
  readonly strip: boolean;
  readonly delimiter: string;
  readonly length: number;
}

interface ShellScanner {
  readonly text: string;
  readonly comments: SourceComment[];
  readonly codeLines: Set<number>;
  readonly pending: Heredoc[];
}

interface ScanRule {
  readonly applies: (text: string, index: number) => boolean;
  readonly take: (scanner: ShellScanner, index: number, nested: boolean) => number;
}

const COMMENT_PREDECESSORS = new Set([" ", "\t", "\n", ";", "&", "|", "(", ")"]);
const HEREDOC = /^<<(-?)\s*(?:'([^']*)'|"([^"]*)"|\\?([A-Za-z_][A-Za-z0-9_]*))/;

function skipSingle(text: string, index: number): number {
  const close = text.indexOf("'", index + 1);
  return close < 0 ? text.length : close + 1;
}

function skipBraces(text: string, index: number): number {
  let depth = 0;
  let cursor = index;
  while (cursor < text.length) {
    const char = text.charAt(cursor);
    depth += char === "{" ? 1 : 0;
    depth -= char === "}" ? 1 : 0;
    cursor += char === "\\" ? 2 : 1;
    if (depth === 0 && char === "}") return cursor;
  }
  return text.length;
}

function doubleQuotedStep(scanner: ShellScanner, cursor: number): number {
  const { text } = scanner;
  if (text.charAt(cursor) === "\\") return cursor + 2;
  if (text.startsWith("$(", cursor)) return scanCode(scanner, cursor + 2, true);
  if (text.startsWith("${", cursor)) return skipBraces(text, cursor + 1);
  return cursor + 1;
}

function skipDouble(scanner: ShellScanner, index: number): number {
  let cursor = index + 1;
  while (cursor < scanner.text.length && scanner.text.charAt(cursor) !== '"') cursor = doubleQuotedStep(scanner, cursor);
  return cursor + 1;
}

function readHeredoc(text: string, index: number): Heredoc | null {
  const match = HEREDOC.exec(text.slice(index, index + 80));
  if (!match || text.charAt(index + 2) === "<") return null;
  return { strip: match[1] === "-", delimiter: match[2] ?? match[3] ?? match[4] ?? "", length: match[0].length };
}

function skipHeredocBody(text: string, from: number, heredoc: Heredoc): number {
  let cursor = from;
  while (cursor < text.length) {
    const lineEnd = text.indexOf("\n", cursor);
    const end = lineEnd < 0 ? text.length : lineEnd;
    const content = heredoc.strip ? text.slice(cursor, end).replace(/^\t+/, "") : text.slice(cursor, end);
    cursor = end + 1;
    if (content === heredoc.delimiter) break;
  }
  return Math.min(cursor, text.length);
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function takeComment(scanner: ShellScanner, index: number): number {
  const { text } = scanner;
  const lineEnd = text.indexOf("\n", index);
  const end = lineEnd < 0 ? text.length : lineEnd;
  const line = lineAt(text, index);
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  scanner.comments.push({ start: index, end, line, endLine: line, ownLine: text.slice(lineStart, index).trim() === "", joinable: true, text: text.slice(index, end) });
  return end;
}

function takeNewline(scanner: ShellScanner, index: number, nested: boolean): number {
  let next = index + 1;
  for (const heredoc of scanner.pending.splice(0)) next = skipHeredocBody(scanner.text, next, heredoc);
  if (!nested) scanner.codeLines.add(lineAt(scanner.text, next));
  return next;
}

function takeHeredocMarker(scanner: ShellScanner, index: number): number {
  const heredoc = readHeredoc(scanner.text, index);
  if (heredoc === null) return index + 1;
  scanner.pending.push(heredoc);
  return index + heredoc.length;
}

const skipEscape = (_scanner: ShellScanner, index: number): number => index + 2;

const RULES: ReadonlyArray<ScanRule> = [
  { applies: (text, index) => text.charAt(index) === "\n", take: takeNewline },
  { applies: (text, index) => text.charAt(index) === "\\", take: skipEscape },
  { applies: (text, index) => text.charAt(index) === "'", take: (scanner, index) => skipSingle(scanner.text, index) },
  { applies: (text, index) => text.charAt(index) === '"', take: skipDouble },
  { applies: (text, index) => text.startsWith("$'", index), take: (scanner, index) => skipSingle(scanner.text, index + 1) },
  { applies: (text, index) => text.startsWith("${", index), take: (scanner, index) => skipBraces(scanner.text, index + 1) },
  { applies: (text, index) => text.charAt(index) === "#" && (index === 0 || COMMENT_PREDECESSORS.has(text.charAt(index - 1))), take: takeComment },
  { applies: (text, index) => text.startsWith("<<", index) && readHeredoc(text, index) !== null, take: takeHeredocMarker },
  { applies: (text, index) => text.charAt(index) === "(", take: (scanner, index) => scanCode(scanner, index + 1, true) },
];

function scanCode(scanner: ShellScanner, from: number, nested: boolean): number {
  let index = from;
  while (index < scanner.text.length) {
    if (nested && scanner.text.charAt(index) === ")") return index + 1;
    const rule = RULES.find(({ applies }) => applies(scanner.text, index));
    index = rule ? rule.take(scanner, index, nested) : index + 1;
  }
  return index;
}

/** Comments of a shell script as { line, endLine, ownLine, text, start, end, joinable }, plus the lines that begin in plain code. */
export function scanShell(text: string): ScriptScan {
  const scanner: ShellScanner = { text, comments: [], codeLines: new Set([1]), pending: [] };
  scanCode(scanner, 0, false);
  return { comments: scanner.comments, codeLines: scanner.codeLines };
}
