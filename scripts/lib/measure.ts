// Structural measurement for the check gate: logical lines, function metrics and unsafe syntax.
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import ts from "typescript";

export const MAX_FILE_LINES = 400;
export const MAX_FUNCTION_LINES = 40;
export const MAX_COMPLEXITY = 8;
export const MAX_NESTING = 3;
export const MAX_PARAMS = 4;

/** The first and last line of one non-trivia token, with its start offset. */
export interface TokenSpan {
  readonly start: number;
  readonly first: number;
  readonly last: number;
}

/** Size and shape of one function: logical lines, complexity, nesting depth and parameter count. */
export interface FunctionMetric {
  readonly name: string;
  readonly line: number;
  readonly lines: number;
  readonly complexity: number;
  readonly nesting: number;
  readonly params: number;
  readonly objectParam: boolean;
  readonly end: number;
}

/** A parsed file: its text and syntax tree. */
export interface ParsedSource {
  readonly text: string;
  readonly source: ts.SourceFile;
}

type MeasuredFunction = ts.FunctionLikeDeclaration & { readonly body: ts.ConciseBody };
type NodeTest = (node: ts.Node) => boolean;

function scriptKind(extension: string): ts.ScriptKind {
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  return extension === ".ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

export function parseSource(file: string): ParsedSource {
  const text = readFileSync(file, "utf8");
  const kind = scriptKind(extname(file));
  return { text, source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind) };
}

export function lineOf(source: ts.SourceFile, position: number): number { return source.getLineAndCharacterOfPosition(position).line + 1; }

export function tokenSpans(source: ts.SourceFile): TokenSpan[] {
  const spans: TokenSpan[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(source);
    if (children.length) { for (const child of children) visit(child); return; }
    const start = node.getStart(source);
    if (node.end > start) spans.push({ start, first: lineOf(source, start), last: lineOf(source, node.end) });
  };
  visit(source);
  return spans;
}

export function logicalLines(spans: ReadonlyArray<TokenSpan>, start: number, end: number): number {
  const lines = new Set<number>();
  for (const span of spans) {
    if (span.start < start || span.start >= end) continue;
    for (let line = span.first; line <= span.last; line += 1) lines.add(line);
  }
  return lines.size;
}

function functionName(node: ts.FunctionLikeDeclaration, source: ts.SourceFile): string {
  if (node.name) return node.name.getText(source);
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return "<anonymous>";
  return "<function>";
}

const COMPLEXITY_OPERATORS = [
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
];
const LOOP_KINDS: ReadonlyArray<NodeTest> = [ts.isForStatement, ts.isForInStatement, ts.isForOfStatement, ts.isWhileStatement, ts.isDoStatement];
const ALTERNATIVE_KINDS: ReadonlyArray<NodeTest> = [ts.isIfStatement, ts.isCatchClause, ts.isCaseClause, ts.isConditionalExpression];

function isLoop(node: ts.Node): boolean { return LOOP_KINDS.some((check) => check(node)); }
function isAlternative(node: ts.Node): boolean { return ALTERNATIVE_KINDS.some((check) => check(node)); }
function isShortCircuit(node: ts.Node): boolean { return ts.isBinaryExpression(node) && COMPLEXITY_OPERATORS.includes(node.operatorToken.kind); }
function isOptionalChain(node: ts.Node): boolean {
  return (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) && node.questionDotToken !== undefined;
}

function isDefaultBinding(node: ts.Node): boolean {
  if (ts.isBindingElement(node)) return node.initializer !== undefined;
  if (ts.isShorthandPropertyAssignment(node)) return node.objectAssignmentInitializer !== undefined;
  return false;
}

function branchComplexity(node: ts.Node): boolean {
  if (isLoop(node) || isAlternative(node) || isOptionalChain(node)) return true;
  return isShortCircuit(node) || isDefaultBinding(node);
}

function branchNesting(node: ts.Node): boolean { return isLoop(node) || isAlternative(node); }

function parameterComplexity(parameters: ts.NodeArray<ts.ParameterDeclaration>): number {
  let complexity = 0;
  const walk = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (branchComplexity(node)) complexity += 1;
    ts.forEachChild(node, walk);
  };
  for (const parameter of parameters) {
    if (parameter.initializer) complexity += 1;
    walk(parameter);
  }
  return complexity;
}

function bodyComplexity(owner: ts.Node, body: ts.Node): { readonly complexity: number; readonly nesting: number } {
  let complexity = 1;
  let maxNesting = 0;
  const walk = (child: ts.Node, depth: number): void => {
    if (child !== owner && ts.isFunctionLike(child)) return;
    const branch = branchComplexity(child);
    const nextDepth = branchNesting(child) ? depth + 1 : depth;
    if (branch) { complexity += 1; maxNesting = Math.max(maxNesting, nextDepth); }
    ts.forEachChild(child, (grandchild) => walk(grandchild, nextDepth));
  };
  walk(body, 0);
  return { complexity, nesting: maxNesting };
}

function isObjectParameter(node: MeasuredFunction): boolean {
  const [parameter] = node.parameters;
  if (node.parameters.length !== 1 || !parameter) return false;
  if (ts.isObjectBindingPattern(parameter.name)) return true;
  const type = parameter.type;
  return Boolean(type && (ts.isTypeLiteralNode(type) || ts.isTypeReferenceNode(type)));
}

function functionMetric(node: MeasuredFunction, source: ts.SourceFile, spans: ReadonlyArray<TokenSpan>): FunctionMetric {
  const body = bodyComplexity(node, node.body);
  const complexity = body.complexity + parameterComplexity(node.parameters);
  const start = lineOf(source, node.getStart(source));
  return {
    name: functionName(node, source),
    line: start,
    lines: logicalLines(spans, node.getStart(source), node.end),
    complexity,
    nesting: body.nesting,
    params: node.parameters.filter((parameter) => parameter.name.getText(source) !== "this").length,
    objectParam: isObjectParameter(node),
    end: lineOf(source, node.end),
  };
}

function unwrapParentheses(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function topLevelIifes(source: ts.SourceFile): Set<ts.Node> {
  const wrappers = new Set<ts.Node>();
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const call = unwrapParentheses(statement.expression);
    if (!ts.isCallExpression(call)) continue;
    const callee = unwrapParentheses(call.expression);
    if (ts.isFunctionExpression(callee)) wrappers.add(callee);
  }
  return wrappers;
}

const FUNCTION_GUARDS: ReadonlyArray<NodeTest> = [
  ts.isFunctionDeclaration, ts.isMethodDeclaration, ts.isConstructorDeclaration, ts.isGetAccessorDeclaration,
  ts.isSetAccessorDeclaration, ts.isFunctionExpression, ts.isArrowFunction,
];

function isMeasuredFunction(node: ts.Node): node is MeasuredFunction {
  return FUNCTION_GUARDS.some((check) => check(node)) && "body" in node && node.body !== undefined;
}

/** Function metrics; with `moduleIife` a top-level IIFE is the file's module wrapper (measured as the file, not as a function). */
export function functionMetrics(
  source: ts.SourceFile,
  spans: ReadonlyArray<TokenSpan>,
  { moduleIife = false }: { readonly moduleIife?: boolean } = {},
): FunctionMetric[] {
  const metrics: FunctionMetric[] = [];
  const wrappers = moduleIife ? topLevelIifes(source) : new Set<ts.Node>();
  const visit = (node: ts.Node): void => {
    if (isMeasuredFunction(node) && !wrappers.has(node)) metrics.push(functionMetric(node, source, spans));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return metrics;
}

function assertionKeywordFailures(node: ts.AsExpression | ts.TypeAssertion, source: ts.SourceFile, angleBracket: boolean): string[] {
  const line = lineOf(source, node.getStart(source));
  const failures: string[] = [];
  if (node.type.kind === ts.SyntaxKind.AnyKeyword) failures.push(`line ${line}: ${angleBracket ? "angle-bracket any assertion" : "assertion to any"}`);
  if (node.type.kind === ts.SyntaxKind.NeverKeyword) failures.push(`line ${line}: ${angleBracket ? "angle-bracket never assertion" : "assertion to never"}; never is assignable to every type, so narrow or parse the value instead`);
  return failures;
}

function unwrapExternalValue(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current)) current = current.expression;
  return current;
}

function isNamedCall(call: ts.CallExpression, objectName: string, propertyName: string): boolean {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  return ts.isIdentifier(callee.expression) && callee.expression.text === objectName && callee.name.text === propertyName;
}

function isExternalValue(node: ts.Expression): boolean {
  const current = unwrapExternalValue(node);
  if (!ts.isCallExpression(current)) return false;
  if (ts.isIdentifier(current.expression)) return current.expression.text === "fetch";
  if (!ts.isPropertyAccessExpression(current.expression)) return false;
  const property = current.expression.name.text;
  return isNamedCall(current, "JSON", "parse") || property === "json" || property === "text";
}

function isUntrustedShape(node: ts.TypeNode, source: ts.SourceFile): boolean {
  if (node.kind === ts.SyntaxKind.UnknownKeyword) return true;
  return ts.isTypeReferenceNode(node) && node.typeName.getText(source) === "Record" && node.typeArguments?.length === 2 && node.typeArguments[1]?.kind === ts.SyntaxKind.UnknownKeyword;
}

function asExpressionFailures(node: ts.AsExpression, source: ts.SourceFile): string[] {
  const line = lineOf(source, node.getStart(source));
  const failures = [...assertionKeywordFailures(node, source, false)];
  if (ts.isAsExpression(node.expression) || ts.isTypeAssertionExpression(node.expression)) failures.push(`line ${line}: double assertion`);
  if (node.type.getText(source) === "unknown" && ts.isAsExpression(node.expression)) failures.push(`line ${line}: unknown escape assertion`);
  if (isExternalValue(node.expression) && !isUntrustedShape(node.type, source)) failures.push(`line ${line}: unchecked external-data assertion; parse unknown data before assigning a domain type`);
  return failures;
}

function nodeFailures(node: ts.Node, source: ts.SourceFile): string[] {
  const line = lineOf(source, node.getStart(source));
  const failures: string[] = [];
  if (node.kind === ts.SyntaxKind.AnyKeyword) failures.push(`line ${line}: explicit any`);
  if (ts.isIndexSignatureDeclaration(node) && node.type?.kind === ts.SyntaxKind.AnyKeyword) failures.push(`line ${line}: any index signature`);
  if (ts.isAsExpression(node)) failures.push(...asExpressionFailures(node, source));
  if (ts.isTypeAssertionExpression(node)) failures.push(...angleBracketFailures(node, source));
  return failures;
}

function angleBracketFailures(node: ts.TypeAssertion, source: ts.SourceFile): string[] {
  const failures = assertionKeywordFailures(node, source, true);
  const doubled = ts.isAsExpression(node.expression) || ts.isTypeAssertionExpression(node.expression);
  if (doubled) failures.push(`line ${lineOf(source, node.getStart(source))}: double assertion`);
  return failures;
}

/** Escape hatches this repo refuses: any, double assertions, and domain casts over unparsed external data. */
export function unsafeSyntax(source: ts.SourceFile): string[] {
  const failures: string[] = [];
  const visit = (node: ts.Node): void => {
    failures.push(...nodeFailures(node, source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return failures;
}
