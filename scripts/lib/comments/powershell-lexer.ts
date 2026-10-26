// Finds the comments of a PowerShell script, skipping strings, here-strings and subexpressions.
import type { ScriptScan, SourceComment } from "./comment-blocks.ts";

interface PowershellScanner {
  readonly text: string;
  readonly comments: SourceComment[];
  readonly codeLines: Set<number>;
}

interface ScanRule {
  readonly applies: (text: string, index: number) => boolean;
  readonly take: (scanner: PowershellScanner, index: number, nested: boolean) => number;
}

const COMMENT_PREDECESSORS = new Set([" ", "\t", "\n", "\r", ";", "|", "(", "{", ")", ","]);

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function skipSingle(text: string, index: number): number {
  let cursor = index + 1;
  while (cursor < text.length) {
    if (text.charAt(cursor) === "'" && text.charAt(cursor + 1) === "'") cursor += 2;
    else if (text.charAt(cursor) === "'") return cursor + 1;
    else cursor += 1;
  }
  return cursor;
}

function doubleQuotedStep(scanner: PowershellScanner, cursor: number): number {
  const { text } = scanner;
  if (text.charAt(cursor) === "`") return cursor + 2;
  if (text.startsWith("$(", cursor)) return scanCode(scanner, cursor + 2, true);
  return cursor + 1;
}

function skipDouble(scanner: PowershellScanner, index: number): number {
  let cursor = index + 1;
  while (cursor < scanner.text.length && scanner.text.charAt(cursor) !== '"') cursor = doubleQuotedStep(scanner, cursor);
  return cursor + 1;
}

function skipHereString(scanner: PowershellScanner, index: number): number {
  const closer = `\n${scanner.text.charAt(index + 1)}@`;
  const close = scanner.text.indexOf(closer, index);
  return close < 0 ? scanner.text.length : close + closer.length;
}

function takeComment(scanner: PowershellScanner, index: number): number {
  const { text } = scanner;
  const block = text.startsWith("<#", index);
  const close = block ? text.indexOf("#>", index + 2) : text.indexOf("\n", index);
  const lineEnd = close > 0 && text.charAt(close - 1) === "\r" ? close - 1 : close;
  const end = close < 0 ? text.length : block ? close + 2 : lineEnd;
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const line = lineAt(text, index);
  const endLine = lineAt(text, Math.max(index, end - 1));
  scanner.comments.push({ start: index, end, line, endLine, ownLine: text.slice(lineStart, index).trim() === "", joinable: !block, text: text.slice(index, end) });
  return end;
}

function takeNewline(scanner: PowershellScanner, index: number, nested: boolean): number {
  if (!nested) scanner.codeLines.add(lineAt(scanner.text, index + 1));
  return index + 1;
}

const skipEscape = (_scanner: PowershellScanner, index: number): number => index + 2;

const startsComment = (text: string, index: number): boolean =>
  text.startsWith("<#", index) || (text.charAt(index) === "#" && (index === 0 || COMMENT_PREDECESSORS.has(text.charAt(index - 1))));

const RULES: ReadonlyArray<ScanRule> = [
  { applies: (text, index) => text.charAt(index) === "\n", take: takeNewline },
  { applies: (text, index) => text.charAt(index) === "`", take: skipEscape },
  { applies: (text, index) => text.charAt(index) === "'", take: (scanner, index) => skipSingle(scanner.text, index) },
  { applies: (text, index) => text.startsWith('@"', index) || text.startsWith("@'", index), take: skipHereString },
  { applies: (text, index) => text.charAt(index) === '"', take: skipDouble },
  { applies: startsComment, take: takeComment },
  { applies: (text, index) => text.charAt(index) === "(", take: (scanner, index) => scanCode(scanner, index + 1, true) },
];

function scanCode(scanner: PowershellScanner, from: number, nested: boolean): number {
  let index = from;
  while (index < scanner.text.length) {
    if (nested && scanner.text.charAt(index) === ")") return index + 1;
    const rule = RULES.find(({ applies }) => applies(scanner.text, index));
    index = rule ? rule.take(scanner, index, nested) : index + 1;
  }
  return index;
}

/** Comments of a PowerShell script in the same shape as scanShell, plus the lines that begin in plain code. */
export function scanPowershell(text: string): ScriptScan {
  const scanner: PowershellScanner = { text, comments: [], codeLines: new Set([1]) };
  scanCode(scanner, 0, false);
  return { comments: scanner.comments, codeLines: scanner.codeLines };
}
