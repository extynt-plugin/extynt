// Finds the typing escape hatches in one TS source: any, casts, non-null assertions and the restricted stand-in types.
import ts from "typescript";

const FIELDS = ["any", "casts", "nonNull", "restricted"] as const;

/** One kind of typing escape hatch counted in a source. */
export type EscapeField = (typeof FIELDS)[number];

/** How many of each escape hatch a source holds. */
export type EscapeCounts = Record<EscapeField, number>;

function isRecordOfLoose(node: ts.TypeReferenceNode): boolean {
  const [key, value] = node.typeArguments ?? [];
  const loose = value !== undefined && (value.kind === ts.SyntaxKind.UnknownKeyword || value.kind === ts.SyntaxKind.AnyKeyword);
  return ts.isIdentifier(node.typeName) && node.typeName.text === "Record" && key?.kind === ts.SyntaxKind.StringKeyword && loose;
}

function isRestrictedType(node: ts.Node): boolean {
  if (node.kind === ts.SyntaxKind.ObjectKeyword) return true;
  if (ts.isTypeLiteralNode(node)) return node.members.length === 0;
  if (!ts.isTypeReferenceNode(node)) return false;
  return (ts.isIdentifier(node.typeName) && node.typeName.text === "Function") || isRecordOfLoose(node);
}

function isCast(node: ts.Node): boolean {
  return (ts.isAsExpression(node) && !ts.isConstTypeReference(node.type)) || ts.isTypeAssertionExpression(node);
}

function fieldOf(node: ts.Node): EscapeField | null {
  if (node.kind === ts.SyntaxKind.AnyKeyword) return "any";
  if (isCast(node)) return "casts";
  if (ts.isNonNullExpression(node)) return "nonNull";
  return isRestrictedType(node) ? "restricted" : null;
}

/** The escape-hatch counts of one TS source file text: { any, casts, nonNull, restricted }. */
export function escapeCounts(key: string, text: string): EscapeCounts {
  const counts: EscapeCounts = { any: 0, casts: 0, nonNull: 0, restricted: 0 };
  const source = ts.createSourceFile(key, text, ts.ScriptTarget.Latest, true, key.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    const field = fieldOf(node);
    if (field) counts[field] += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return counts;
}

/** The escape-hatch fields in report order. */
export const ESCAPE_FIELDS = FIELDS;
