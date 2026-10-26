// Scans an Inno Setup script: the ; comments of its sections, the Pascal comments of [Code], and a masked copy of the code.
import type { SourceComment } from "./comments/comment-blocks.ts";

/** What a scan of an .iss file finds: every comment, the lines holding code or directives, and the [Code] lines with comments and string bodies blanked. */
export interface InnoScan {
  readonly comments: ReadonlyArray<SourceComment>;
  readonly codeLines: ReadonlySet<number>;
  readonly masked: ReadonlyArray<string>;
}

interface OpenBlock {
  readonly line: number;
  readonly start: number;
  readonly close: string;
  readonly ownLine: boolean;
  text: string;
}

interface Walk {
  readonly comments: SourceComment[];
  readonly codeLines: Set<number>;
  readonly masked: string[];
  section: string;
  offset: number;
  open: OpenBlock | undefined;
}

interface Step {
  readonly masked: string;
  readonly next: number;
}

interface Position {
  readonly line: string;
  readonly index: number;
  readonly number: number;
}

const SECTION = /^\[(\w+)\]\s*$/;
const blank = (text: string): string => text.replace(/\S/g, " ");

function pushComment(walk: Walk, comment: Omit<SourceComment, "start">, start: number): void {
  walk.comments.push({ ...comment, start });
}

function endOfString(line: string, from: number): number {
  let index = from + 1;
  while (index < line.length) {
    if (line[index] !== "'") index += 1;
    else if (line[index + 1] === "'") index += 2;
    else return index + 1;
  }
  return line.length;
}

function continueBlock(walk: Walk, at: Position, block: OpenBlock): Step {
  const found = at.line.indexOf(block.close, at.index);
  const next = found < 0 ? at.line.length : found + block.close.length;
  block.text += at.line.slice(at.index, next) + (found < 0 ? "\n" : "");
  if (found >= 0) {
    const { line, ownLine, text } = block;
    pushComment(walk, { end: walk.offset + next, line, endLine: at.number, ownLine, joinable: false, text }, block.start);
    walk.open = undefined;
  }
  return { masked: blank(at.line.slice(at.index, next)), next };
}

function lineComment(walk: Walk, at: Position): Step {
  const text = at.line.slice(at.index);
  const ownLine = at.line.slice(0, at.index).trim() === "";
  pushComment(walk, { end: walk.offset + at.line.length, line: at.number, endLine: at.number, ownLine, joinable: true, text }, walk.offset + at.index);
  return { masked: blank(text), next: at.line.length };
}

function startBlock(walk: Walk, at: Position, opener: string, close: string): Step {
  const ownLine = at.line.slice(0, at.index).trim() === "";
  const block: OpenBlock = { line: at.number, start: walk.offset + at.index, close, ownLine, text: opener };
  walk.open = block;
  const rest = continueBlock(walk, { ...at, index: at.index + opener.length }, block);
  return { masked: blank(opener) + rest.masked, next: rest.next };
}

function startToken(walk: Walk, at: Position): Step {
  const rest = at.line.slice(at.index);
  if (rest.startsWith("'")) {
    const next = endOfString(at.line, at.index);
    return { masked: `'${blank(at.line.slice(at.index + 1, next - 1))}'`, next };
  }
  if (rest.startsWith("//")) return lineComment(walk, at);
  if (rest.startsWith("{")) return startBlock(walk, at, "{", "}");
  if (rest.startsWith("(*")) return startBlock(walk, at, "(*", "*)");
  return { masked: rest.slice(0, 1), next: at.index + 1 };
}

function scanCodeLine(walk: Walk, line: string, number: number): void {
  let out = "";
  let index = 0;
  while (index < line.length) {
    const at = { line, index, number };
    const step = walk.open ? continueBlock(walk, at, walk.open) : startToken(walk, at);
    out += step.masked;
    index = step.next;
  }
  walk.masked[number - 1] = out;
  if (out.trim() !== "") walk.codeLines.add(number);
}

function scanSectionLine(walk: Walk, line: string, number: number): void {
  const trimmed = line.trim();
  if (trimmed.startsWith(";")) {
    lineComment(walk, { line, index: line.indexOf(";"), number });
    return;
  }
  if (trimmed !== "") walk.codeLines.add(number);
}

function scanLine(walk: Walk, line: string, number: number): void {
  walk.masked[number - 1] = "";
  const header = walk.open === undefined ? SECTION.exec(line) : null;
  const inCode = walk.section === "code" && !header;
  if (header?.[1]) walk.section = header[1].toLowerCase();
  if (inCode) scanCodeLine(walk, line, number);
  else scanSectionLine(walk, line, number);
  walk.offset += line.length + 1;
}

/** Scans an .iss file's text; line numbers are 1-based. */
export function scanInno(text: string): InnoScan {
  const walk: Walk = { comments: [], codeLines: new Set(), masked: [], section: "", offset: 0, open: undefined };
  text.split(/\r?\n/).forEach((line, index) => scanLine(walk, line, index + 1));
  return { comments: walk.comments, codeLines: walk.codeLines, masked: walk.masked };
}
