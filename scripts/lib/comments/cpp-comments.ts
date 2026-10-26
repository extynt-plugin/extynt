// Comment policy for C++ and Objective-C++: a header comment everywhere, doc comments only on header declarations.
import { blockFailure, groupBlocks, isDirectlyAbove } from "./comment-blocks.ts";
import type { SourceComment } from "./comment-blocks.ts";
import { lexCpp } from "./cpp-lexer.ts";
import type { CppToken } from "./cpp-lexer.ts";

interface DeclarationState {
  stack: Array<"scope" | "body">;
  parens: number;
  head: CppToken[];
  objcLine: number | undefined;
}


const SCOPE_KEYWORDS = new Set(["namespace", "class", "struct", "union", "enum", "extern"]);
const ACCESS_LABELS = new Set(["public", "private", "protected"]);
const COMMENT_KINDS = new Set(["line-comment", "block-comment"]);
const MISSING_HEADER = "the file must open with one header comment (what the module is for and where it sits)";

function isScopeHead(head: ReadonlyArray<CppToken>): boolean {
  const words = head.map((token) => token.text);
  return words.some((word) => SCOPE_KEYWORDS.has(word)) && !words.includes("(") && !words.includes("=");
}

function closeToken(state: DeclarationState, token: CppToken): void {
  if (token.text === ")" || token.text === "]") state.parens = Math.max(0, state.parens - 1);
  else if (token.text === "}") state.stack.pop();
}

function openToken(state: DeclarationState, token: CppToken): void {
  if (token.text === "(" || token.text === "[") state.parens += 1;
  else if (token.text === "{") state.stack.push(state.parens === 0 && isScopeHead(state.head) ? "scope" : "body");
}

function isBoundary(state: DeclarationState, token: CppToken): boolean {
  if (token.kind === "directive" || [";", "{", "}"].includes(token.text)) return true;
  const [only] = state.head;
  return token.text === ":" && state.head.length === 1 && only !== undefined && ACCESS_LABELS.has(only.text);
}

function isAfterAt(state: DeclarationState, token: CppToken, words: ReadonlyArray<string>): boolean {
  return state.head.length === 1 && state.head[0]?.text === "@" && words.includes(token.text);
}

function closesObjcScope(state: DeclarationState, token: CppToken): boolean {
  return isAfterAt(state, token, ["end"]) && state.stack.at(-1) === "scope";
}

function openObjcScope(state: DeclarationState, token: CppToken): void {
  if (!isAfterAt(state, token, ["interface", "protocol"])) return;
  state.stack.push("scope");
  state.objcLine = token.line;
}

function endObjcHead(state: DeclarationState, token: CppToken): void {
  if (state.objcLine === undefined) return;
  if (token.text === ";" && token.line === state.objcLine) state.stack.pop();
  if (token.line > state.objcLine || token.text === ";") {
    state.objcLine = undefined;
    state.head = [];
  }
}

function advance(state: DeclarationState, token: CppToken): void {
  if (closesObjcScope(state, token)) {
    state.stack.pop();
    state.head = [];
    return;
  }
  openObjcScope(state, token);
  closeToken(state, token);
  openToken(state, token);
  if (isBoundary(state, token)) state.head = [];
  else state.head.push(token);
}

function startsDeclaration(state: DeclarationState, token: CppToken): boolean {
  const atScope = state.stack.every((kind) => kind === "scope");
  return atScope && state.parens === 0 && state.head.length === 0 && token.kind !== "directive" && token.text !== "}";
}

function declarationStarts(tokens: ReadonlyArray<CppToken>): ReadonlyMap<number, boolean> {
  const state: DeclarationState = { stack: [], parens: 0, head: [], objcLine: undefined };
  const starts = new Map<number, boolean>();
  for (const token of tokens) {
    if (COMMENT_KINDS.has(token.kind)) continue;
    endObjcHead(state, token);
    starts.set(token.start, startsDeclaration(state, token));
    advance(state, token);
  }
  return starts;
}

function nextCodeToken(tokens: ReadonlyArray<CppToken>, block: SourceComment): CppToken | undefined {
  return tokens.find((token) => token.start >= block.end && !COMMENT_KINDS.has(token.kind));
}

function isDocComment(block: SourceComment, tokens: ReadonlyArray<CppToken>, starts: ReadonlyMap<number, boolean>): boolean {
  const target = nextCodeToken(tokens, block);
  return target !== undefined && starts.get(target.start) === true && isDirectlyAbove(block, target.line);
}

function opensWithComment(tokens: ReadonlyArray<CppToken>): boolean {
  const [first] = tokens;
  return first !== undefined && COMMENT_KINDS.has(first.kind);
}

function commentBlocks(tokens: ReadonlyArray<CppToken>): ReadonlyArray<SourceComment> {
  return groupBlocks(tokens.filter((token) => COMMENT_KINDS.has(token.kind)).map((token) => ({ ...token, joinable: token.kind === "line-comment" })));
}

/** The comment block a .h, .cpp or .mm file opens with, or undefined when its first token is code. */
export function cppHeaderBlock(text: string): SourceComment | undefined {
  const tokens = lexCpp(text);
  return opensWithComment(tokens) ? commentBlocks(tokens)[0] : undefined;
}

/** Failures for a .h, .cpp or .mm file. */
export function cppCommentFailures(key: string, text: string): string[] {
  const tokens = lexCpp(text);
  const blocks = commentBlocks(tokens);
  const opens = opensWithComment(tokens);
  const failures = opens ? [] : [`${key}:1: ${MISSING_HEADER}`];
  const starts = key.endsWith(".h") ? declarationStarts(tokens) : new Map<number, boolean>();
  const body = opens ? blocks.slice(1) : blocks;
  for (const block of body) {
    if (isDocComment(block, tokens, starts)) continue;
    failures.push(blockFailure(key, block, key.endsWith(".h") ? "comment not allowed here; only a doc comment directly above a namespace or class scope declaration is" : "comment not allowed here; sources keep only the header comment"));
  }
  return failures;
}
