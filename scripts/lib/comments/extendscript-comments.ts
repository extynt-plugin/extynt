// Comment policy for ExtendScript (.jsx): a header holding tool declarations, plus one doc comment per exported function or variable.
import ts from "typescript";
import { blockFailure, isDirectlyAbove } from "./comment-blocks.ts";
import type { SourceComment } from "./comment-blocks.ts";
import { analyseSource, lineOfPosition, nextTokenStart, statementAt } from "./typescript-comments.ts";

const DIRECTIVE = /^\/\*\s*(?:globals?|exported)\b/;
const EXPORTED = /\/\*\s*exported\s+([^*]*)\*\//g;
const MISSING_HEADER = "the file must open with one header comment before its /* global */ and /* exported */ declarations";

function exportedNames(header: ReadonlyArray<SourceComment>): Set<string> {
  const names = new Set<string>();
  for (const found of header.map((block) => block.text).join("\n").matchAll(EXPORTED)) for (const name of (found[1] ?? "").split(/[\s,]+/)) if (name) names.add(name);
  return names;
}

function declaredNames(statement: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(statement)) return statement.name ? [statement.name.text] : [];
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration) => (ts.isIdentifier(declaration.name) ? [declaration.name.text] : []));
}

function isDocumentedExport(source: ts.SourceFile, text: string, block: SourceComment, names: ReadonlySet<string>): boolean {
  const statement = statementAt(source, nextTokenStart(text, block.end));
  if (!statement || !declaredNames(statement).some((name) => names.has(name))) return false;
  return isDirectlyAbove(block, lineOfPosition(source, statement.getStart(source)));
}

interface SplitBlocks {
  readonly directives: ReadonlyArray<SourceComment>;
  readonly heading: SourceComment | undefined;
  readonly rest: ReadonlyArray<SourceComment>;
}

function splitBlocks(blocks: ReadonlyArray<SourceComment>, limit: number): SplitBlocks {
  const before = blocks.filter((block) => block.start < limit);
  const directives = before.filter((block) => DIRECTIVE.test(block.text));
  const heading = before.find((block) => !DIRECTIVE.test(block.text));
  const claimed = new Set(heading ? [heading, ...directives] : directives);
  return { directives, heading, rest: blocks.filter((block) => !claimed.has(block)) };
}

/** Failures for a .jsx file. */
export function extendscriptCommentFailures(key: string, text: string): string[] {
  const { source, blocks, limit } = analyseSource(key, text);
  const { directives, heading, rest } = splitBlocks(blocks, limit);
  const names = exportedNames(directives);
  const failures = heading ? [] : [`${key}:1: ${MISSING_HEADER}`];
  for (const block of rest) {
    if (isDocumentedExport(source, text, block, names)) continue;
    failures.push(blockFailure(key, block, "comment not allowed here; only one doc comment above each function or variable named in /* exported */ is"));
  }
  return failures;
}
