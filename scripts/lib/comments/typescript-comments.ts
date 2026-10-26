// Comment policy for TS, TSX, JS and MJS: a header comment, then one doc comment per exported top-level declaration.
import ts from "typescript";
import { blockFailure, groupBlocks, isDirectlyAbove } from "./comment-blocks.ts";
import type { SourceComment } from "./comment-blocks.ts";

/** A parsed TS-family file with its comment blocks and the offset of its first token. */
export interface AnalysedSource {
  readonly source: ts.SourceFile;
  readonly blocks: ReadonlyArray<SourceComment>;
  readonly limit: number;
}

interface DocContext {
  readonly source: ts.SourceFile;
  readonly text: string;
  readonly key: string;
  readonly isTarget: (statement: ts.Statement) => boolean;
}

const KIND_BY_EXTENSION = new Map([[".ts", ts.ScriptKind.TS], [".tsx", ts.ScriptKind.TSX]]);
const MISSING_HEADER = "the file must open with one header comment (what the module is for and where it sits)";
const NOT_ALLOWED = "comment not allowed here; only the header and one doc comment above an exported declaration are";

function walkTokens(node: ts.Node, source: ts.SourceFile, visit: (token: ts.Node) => void): void {
  if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
  if (node.kind === ts.SyntaxKind.JsxText) return;
  const children = node.getChildren(source);
  if (!children.length) visit(node);
  for (const child of children) walkTokens(child, source, visit);
}

function lineOfPosition(source: ts.SourceFile, position: number): number {
  return source.getLineAndCharacterOfPosition(position).line + 1;
}

function toComment(source: ts.SourceFile, text: string, range: ts.CommentRange): SourceComment {
  const line = lineOfPosition(source, range.pos);
  const lineStart = source.getPositionOfLineAndCharacter(line - 1, 0);
  const isLine = range.kind === ts.SyntaxKind.SingleLineCommentTrivia;
  return {
    start: range.pos,
    end: range.end,
    line,
    endLine: lineOfPosition(source, Math.max(range.pos, range.end - 1)),
    ownLine: text.slice(lineStart, range.pos).trim() === "",
    joinable: isLine,
    text: text.slice(range.pos, range.end),
  };
}

/** Every comment of a parsed source, in order, found as leading trivia of the token that follows it. */
export function collectComments(source: ts.SourceFile, text: string): SourceComment[] {
  const seen = new Map<number, SourceComment>();
  walkTokens(source, source, (token) => {
    const ranges = [...(ts.getLeadingCommentRanges(text, token.pos) ?? []), ...(ts.getTrailingCommentRanges(text, token.pos) ?? [])];
    for (const range of ranges) seen.set(range.pos, toComment(source, text, range));
  });
  return [...seen.values()].sort((left, right) => left.start - right.start);
}

function hasExportModifier(statement: ts.Statement): boolean {
  if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) return true;
  return ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function statementAt(source: ts.SourceFile, position: number): ts.Statement | undefined {
  return source.statements.find((statement) => statement.getStart(source) === position);
}

function nextTokenStart(text: string, end: number): number {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text, undefined, end);
  scanner.scan();
  return scanner.getTokenStart();
}

function docFailure(context: DocContext, block: SourceComment): string | null {
  const { source, text, key, isTarget } = context;
  const statement = statementAt(source, nextTokenStart(text, block.end));
  const target = statement !== undefined && isDirectlyAbove(block, lineOfPosition(source, statement.getStart(source)));
  if (target && isTarget(statement)) return null;
  if (target) return blockFailure(key, block, "doc comment on a declaration that is not exported; private helpers carry no comment");
  return blockFailure(key, block, block.ownLine ? NOT_ALLOWED : "trailing comment; rename or extract instead");
}

function firstTokenStart(text: string): number {
  return nextTokenStart(text, ts.getShebang(text)?.length ?? 0);
}

function splitHeader(blocks: ReadonlyArray<SourceComment>, limit: number): { header: SourceComment[]; rest: ReadonlyArray<SourceComment> } {
  const [first, ...others] = blocks;
  const opens = first !== undefined && first.start < limit;
  return { header: opens ? [first] : [], rest: opens ? others : blocks };
}

/** Parses a TS-family file and returns its source, comment blocks and the offset of its first token. */
export function analyseSource(key: string, text: string): AnalysedSource {
  const extension = key.slice(key.lastIndexOf("."));
  const source = ts.createSourceFile(key, text, ts.ScriptTarget.Latest, true, KIND_BY_EXTENSION.get(extension) ?? ts.ScriptKind.JS);
  return { source, blocks: groupBlocks(collectComments(source, text)), limit: firstTokenStart(text) };
}

export { hasExportModifier, lineOfPosition, nextTokenStart, statementAt };

/** Failures for a TS, TSX, JS or MJS file. */
export function typescriptCommentFailures(key: string, text: string): string[] {
  const { source, blocks, limit } = analyseSource(key, text);
  const { header, rest } = splitHeader(blocks, limit);
  const failures: string[] = [];
  if (header.length === 0) failures.push(`${key}:1: ${MISSING_HEADER}`);
  const context: DocContext = { source, text, key, isTarget: hasExportModifier };
  for (const block of rest) {
    const failure = docFailure(context, block);
    if (failure) failures.push(failure);
  }
  return failures;
}
