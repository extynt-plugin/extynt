// A small C++ and Objective-C++ lexer: comments, preprocessor lines, literals and punctuation, enough to place comments.

/** What a C++ token is: a comment, a preprocessor line, a literal, an identifier or one punctuation character. */
export type CppTokenKind = "line-comment" | "block-comment" | "directive" | "string" | "number" | "identifier" | "punctuation";

/** One lexed C++ token with its text, offsets, lines and whether it is the first token on its line. */
export interface CppToken {
  readonly kind: CppTokenKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly endLine: number;
  readonly ownLine: boolean;
}

interface Lexeme {
  readonly end: number;
  readonly kind: CppTokenKind;
}

interface CommentStart {
  readonly opener: string;
  readonly kind: "line-comment" | "block-comment";
  readonly skip: (text: string, index: number) => number;
}

const RAW_PREFIXES = new Set(["R", "LR", "uR", "UR", "u8R"]);
const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_PART = /[A-Za-z0-9_]/;
const NUMBER_PART = /[A-Za-z0-9_.']/;

function endsLogicalLine(text: string, index: number): boolean {
  if (text.charAt(index) !== "\n") return false;
  return text.charAt(index - 1) === "\r" ? text.charAt(index - 2) !== "\\" : text.charAt(index - 1) !== "\\";
}

function skipQuoted(text: string, index: number, quote: string): number {
  let cursor = index + 1;
  while (cursor < text.length && text.charAt(cursor) !== quote && text.charAt(cursor) !== "\n") cursor += text.charAt(cursor) === "\\" ? 2 : 1;
  return Math.min(cursor + 1, text.length);
}

function skipRaw(text: string, index: number): number {
  const open = text.indexOf("(", index);
  const closer = `)${text.slice(index + 1, open)}"`;
  const close = text.indexOf(closer, open);
  return close < 0 ? text.length : close + closer.length;
}

function skipLineComment(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && !endsLogicalLine(text, cursor)) cursor += 1;
  return cursor;
}

function skipBlockComment(text: string, index: number): number {
  const close = text.indexOf("*/", index + 2);
  return close < 0 ? text.length : close + 2;
}

function skipDirective(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && !endsLogicalLine(text, cursor)) {
    if (text.charAt(cursor) === "/" && (text.charAt(cursor + 1) === "/" || text.charAt(cursor + 1) === "*")) break;
    cursor = text.charAt(cursor) === '"' ? skipQuoted(text, cursor, '"') : cursor + 1;
  }
  return cursor;
}

function skipWhile(text: string, index: number, pattern: RegExp): number {
  let cursor = index;
  while (cursor < text.length && pattern.test(text.charAt(cursor))) cursor += 1;
  return cursor;
}

function skipIdentifier(text: string, index: number): Lexeme {
  const end = skipWhile(text, index, IDENTIFIER_PART);
  return text.charAt(end) === '"' && RAW_PREFIXES.has(text.slice(index, end)) ? { end: skipRaw(text, end), kind: "string" } : { end, kind: "identifier" };
}

const COMMENT_STARTS: ReadonlyArray<CommentStart> = [
  { opener: "//", kind: "line-comment", skip: skipLineComment },
  { opener: "/*", kind: "block-comment", skip: skipBlockComment },
];

function readComment(text: string, index: number): Lexeme | null {
  const start = COMMENT_STARTS.find(({ opener }) => text.startsWith(opener, index));
  return start ? { end: start.skip(text, index), kind: start.kind } : null;
}

function readLiteral(text: string, index: number): Lexeme | null {
  const char = text.charAt(index);
  if (char === '"' || char === "'") return { end: skipQuoted(text, index, char), kind: "string" };
  if (IDENTIFIER_START.test(char)) return skipIdentifier(text, index);
  if (/[0-9]/.test(char)) return { end: skipWhile(text, index, NUMBER_PART), kind: "number" };
  return null;
}

function readToken(text: string, index: number, atLineStart: boolean): Lexeme {
  const comment = readComment(text, index);
  if (comment) return comment;
  if (text.charAt(index) === "#" && atLineStart) return { end: skipDirective(text, index), kind: "directive" };
  return readLiteral(text, index) ?? { end: index + 1, kind: "punctuation" };
}

/** Tokens of a C++ or Objective-C++ source: { kind, text, start, line, endLine, ownLine } with no whitespace tokens. */
export function lexCpp(text: string): ReadonlyArray<CppToken> {
  const tokens: CppToken[] = [];
  let index = 0;
  let line = 1;
  let lineHasToken = false;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "\n") { line += 1; lineHasToken = false; index += 1; continue; }
    if (/\s/.test(char)) { index += 1; continue; }
    const { end, kind } = readToken(text, index, !lineHasToken);
    const slice = text.slice(index, end);
    const endLine = line + (slice.match(/\n/g) ?? []).length;
    tokens.push({ kind, text: slice, start: index, end, line, endLine, ownLine: !lineHasToken });
    lineHasToken = true;
    line = endLine;
    index = end;
  }
  return tokens;
}
