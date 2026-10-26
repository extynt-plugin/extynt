// Comment policy for shell and PowerShell: a header block before the first statement, one comment above each function.
import { blockFailure, groupBlocks, isDirectlyAbove } from "./comment-blocks.ts";
import type { SourceComment } from "./comment-blocks.ts";
import { scanPowershell } from "./powershell-lexer.ts";
import { scanShell } from "./shell-lexer.ts";

const SHELL_FUNCTION = /^\s*(?:function\s+)?[A-Za-z_][\w:.-]*\s*\(\)|^\s*function\s+[A-Za-z_][\w:.-]*/;
const POWERSHELL_FUNCTION = /^\s*function\s+[\w:-]+/i;
const SHELL_PREAMBLE = /^\s*(?:#.*|set\s+-.*|)$/;
const POWERSHELL_PREAMBLE = /^\s*(?:#.*|<#.*|Set-StrictMode\b.*|\$ErrorActionPreference\b.*|)$/;
const SHELL_DIRECTIVE = /^#\s*shellcheck\s+source=/;
const POWERSHELL_DIRECTIVE = /^#requires\b/i;
interface NumberedLine {
  readonly text: string;
  readonly line: number;
}

interface ScriptShape {
  readonly powershell: boolean;
  readonly lines: ReadonlyArray<string>;
  readonly codeLines: ReadonlySet<number>;
  readonly blocks: ReadonlyArray<SourceComment>;
  readonly opens: boolean;
}

const MISSING_HEADER = "the script must have a header comment block before its first statement";

function isDirective(comment: SourceComment, powershell: boolean): boolean {
  return (powershell ? POWERSHELL_DIRECTIVE : SHELL_DIRECTIVE).test(comment.text) && comment.ownLine;
}

function isShebang(comment: SourceComment): boolean {
  return comment.line === 1 && comment.text.startsWith("#!");
}

function numberedLines(lines: ReadonlyArray<string>): NumberedLine[] {
  return lines.map((text, index) => ({ text, line: index + 1 }));
}

function plainCodeLines(lines: ReadonlyArray<string>, codeLines: ReadonlySet<number>, pattern: RegExp): NumberedLine[] {
  return numberedLines(lines).filter((entry) => codeLines.has(entry.line) && pattern.test(entry.text));
}

function firstStatementLine(lines: ReadonlyArray<string>, codeLines: ReadonlySet<number>, powershell: boolean): number {
  const preamble = powershell ? POWERSHELL_PREAMBLE : SHELL_PREAMBLE;
  const statement = numberedLines(lines).find((entry) => codeLines.has(entry.line) && !preamble.test(entry.text));
  return statement ? statement.line : lines.length + 1;
}

function documentedFunctionLines(lines: ReadonlyArray<string>, codeLines: ReadonlySet<number>, powershell: boolean): Set<number> {
  const entries = plainCodeLines(lines, codeLines, powershell ? POWERSHELL_FUNCTION : SHELL_FUNCTION);
  return new Set(entries.map((entry) => entry.line));
}

function headerBlocks(comments: ReadonlyArray<SourceComment>, powershell: boolean): ReadonlyArray<SourceComment> {
  return groupBlocks(comments.filter((comment) => !isShebang(comment) && !isDirective(comment, powershell)));
}

function scanScript(key: string, text: string): ScriptShape {
  const powershell = key.endsWith(".ps1");
  const { comments, codeLines } = powershell ? scanPowershell(text) : scanShell(text);
  const lines = text.split(/\r?\n/);
  const blocks = headerBlocks(comments, powershell);
  const [first] = blocks;
  const opens = first !== undefined && first.line < firstStatementLine(lines, codeLines, powershell);
  return { powershell, lines, codeLines, blocks, opens };
}

/** The header block of a shell or PowerShell script: the first comment block, when it starts before the first statement. */
export function scriptHeaderBlock(key: string, text: string): SourceComment | undefined {
  const { blocks, opens } = scanScript(key, text);
  return opens ? blocks[0] : undefined;
}

/** Failures for a .sh or .ps1 file. */
export function scriptCommentFailures(key: string, text: string): string[] {
  const { powershell, lines, codeLines, blocks, opens } = scanScript(key, text);
  const functionLines = documentedFunctionLines(lines, codeLines, powershell);
  const failures = opens ? [] : [`${key}:1: ${MISSING_HEADER}`];
  const misplaced = (opens ? blocks.slice(1) : blocks).filter((block) => !(isDirectlyAbove(block, block.endLine + 1) && functionLines.has(block.endLine + 1)));
  return [...failures, ...misplaced.map((block) => blockFailure(key, block, "comment not allowed here; only the header and one comment directly above a function are"))];
}
