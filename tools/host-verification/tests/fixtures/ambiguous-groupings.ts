/**
 * The ES3 grouping guard both ExtendScript suites share.
 *
 * Live AE 26.2.1 evaluated `a ? b : c ? d : e` as `(a ? b : c) ? d : e` and
 * `A || B && C` as `(A || B) && C`, so every tracked .jsx file must group those
 * operators explicitly. The report strings are assertion data for the callers.
 */
import ts from "typescript";

type Report = (node: ts.Node, why: string) => void;

const isLogical = (node: ts.Node, kind: ts.SyntaxKind): boolean => ts.isBinaryExpression(node) && node.operatorToken.kind === kind;

const reportNestedTernaries = (node: ts.ConditionalExpression, report: Report): void => {
  for (const part of [node.condition, node.whenTrue, node.whenFalse]) if (ts.isConditionalExpression(part)) report(part, "nested ternary without parentheses");
  if (isLogical(node.condition, ts.SyntaxKind.BarBarToken) || isLogical(node.condition, ts.SyntaxKind.AmpersandAmpersandToken)) report(node.condition, "logical ternary condition without parentheses");
};

interface MixedRule { outer: ts.SyntaxKind; inner: ts.SyntaxKind; why: string }

const MIXED_RULES: readonly MixedRule[] = [
  { outer: ts.SyntaxKind.BarBarToken, inner: ts.SyntaxKind.AmpersandAmpersandToken, why: "&& inside || without parentheses" },
  { outer: ts.SyntaxKind.AmpersandAmpersandToken, inner: ts.SyntaxKind.BarBarToken, why: "|| inside && without parentheses" },
];

const reportMixedLogical = (node: ts.BinaryExpression, rule: MixedRule, report: Report): void => {
  if (node.operatorToken.kind !== rule.outer) return;
  for (const part of [node.left, node.right]) if (isLogical(part, rule.inner)) report(part, rule.why);
};

export function ambiguousGroupings(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES5, true, ts.ScriptKind.JS), found: string[] = [];
  const report: Report = (node, why) => found.push(`${fileName}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1} ${why}`);
  const visit = (node: ts.Node): void => {
    if (ts.isConditionalExpression(node)) reportNestedTernaries(node, report);
    if (ts.isBinaryExpression(node)) for (const rule of MIXED_RULES) reportMixedLogical(node, rule, report);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
