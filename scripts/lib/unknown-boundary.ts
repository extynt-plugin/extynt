// The unknown-boundary rule: the `unknown` type keyword is allowed only inside packages/decode/src, the single boundary package.
import ts from "typescript";
import { areaOf } from "./areas.ts";
import type { SourceEntry } from "./source-entry.ts";

/** One `unknown` keyword outside packages/decode/src: its 1-based line and why it is rejected. */
export interface UnknownViolation {
  readonly line: number;
  readonly message: string;
}

const DECODE_SOURCE = "packages/decode/src/";
const KIND = ts.SyntaxKind;

function typeName(node: ts.Node | undefined): string {
  if (node === undefined || !ts.isTypeReferenceNode(node)) return "";
  return ts.isIdentifier(node.typeName) ? node.typeName.text : node.typeName.right.text;
}

function isExportedStatement(node: ts.Node): boolean {
  const statement = ts.findAncestor(node, (ancestor) => ts.isSourceFile(ancestor.parent));
  if (statement === undefined || !ts.canHaveModifiers(statement)) return false;
  return (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === KIND.ExportKeyword);
}

function genericReason(node: ts.Node): string | null {
  const parent = node.parent;
  if (ts.isTypeParameterDeclaration(parent)) return parent.constraint === node ? "`extends unknown` constrains nothing; drop the constraint" : "a generic defaulting to unknown hides the missing type argument";
  if (ts.isArrayTypeNode(parent) || ["Array", "ReadonlyArray"].includes(typeName(parent))) return "`unknown[]` is an untyped list; decode the element type";
  if (typeName(parent) === "Record") return "`Record<string, unknown>` is an untyped shape; name the fields";
  return null;
}

function placementReason(node: ts.Node): string {
  if (isExportedStatement(node)) return "an exported declaration carries unknown; export the decoded type instead";
  if (ts.findAncestor(node, ts.isVariableDeclaration)) return "an unknown variable outside a decoder; decode it at the boundary";
  return "unknown outside packages/decode/src; give the value a precise type or take it from a decoder";
}

function violationReason(node: ts.Node): string {
  return genericReason(node) ?? placementReason(node);
}

/** [{ line, message }] for every `unknown` type keyword that is not at a boundary; `key` is the repo-relative path. */
export function unknownViolations(key: string, text: string): UnknownViolation[] {
  if (key.startsWith(DECODE_SOURCE)) return [];
  const source = ts.createSourceFile(key, text, ts.ScriptTarget.Latest, true, key.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: UnknownViolation[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === KIND.UnknownKeyword) {
      found.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message: violationReason(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The unknown-boundary failures of {key, text} entries, formatted `file:line: reason`. */
export function unknownBoundaryFailures(entries: ReadonlyArray<SourceEntry>): string[] {
  return entries.flatMap(({ key, text }) => unknownViolations(key, text).map(({ line, message }) => `${key}:${line}: ${message}`));
}

/** Per-area count lines for formatted failures, largest first, so a red stage shows where the unknowns live. */
export function unknownBoundarySummary(failures: ReadonlyArray<string>): string[] {
  const counts = new Map<string, number>();
  for (const failure of failures) {
    const area = areaOf(failure.slice(0, failure.indexOf(":")));
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  const rows = [...counts].sort((left, right) => right[1] - left[1]);
  return [`${failures.length} unknown(s) outside packages/decode/src in ${rows.length} area(s)`, ...rows.map(([area, count]) => `${area}: ${count}`)];
}
