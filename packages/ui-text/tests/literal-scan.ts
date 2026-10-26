/** The hard-coded English rule: finds the string literals in a TypeScript file that read as words a user would see, so every one must live in the catalogue instead. */
import ts from "typescript";

/** One literal that reads as user-facing English: where it is and what it says. */
export interface Offence { readonly line: number; readonly text: string }

/** What the rule needs to know about the code base: class names the styles define, and words and exact literals that are known not to be user text. */
export interface ScanVocabulary { readonly classNames: ReadonlySet<string>; readonly notTextWords: ReadonlySet<string>; readonly notTextLiterals: ReadonlySet<string> }

const STOP_WORDS = new Set(["the", "a", "an", "of", "to", "in", "on", "and", "or", "for", "with", "is", "are", "was", "were", "not", "no", "your", "you", "it", "its", "this", "that", "from", "by", "at", "be", "has", "have", "can", "could", "will", "may", "as", "if", "but", "so", "than", "then", "when", "while", "all", "any", "one", "per"]);
const SAFE_CALLEES = new Set(["Error", "TypeError", "RangeError", "log", "warn", "error", "info", "debug", "assert", "addEventListener", "removeEventListener", "getAttribute", "removeAttribute", "querySelector", "querySelectorAll", "getElementById", "createElement", "createElementNS", "getItem", "setItem", "removeItem", "hasOwn", "requestAnimationFrame", "Symbol"]);
const CLASS_CALLEES = new Set(["add", "remove", "toggle", "contains"]);
const WORD = /[\p{L}]{2,}/gu;
const NON_ASCII_LETTER = /(?![\x00-\x7f])\p{L}/u;
const SELECTOR = /(?:^|\s)[#.][A-Za-z]|[>\[\]=]/;
const NOT_PROSE = /^(?:[a-z][a-z0-9+.-]*:\/\/|\.{0,2}\/|#[0-9a-fA-F]{3,8}$|[\w.-]+@[\w.-]+$)/;

function calleeNameOf(callee: ts.Expression): string {
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return ts.isIdentifier(callee) ? callee.text : "";
}

function isClassListCall(callee: ts.Expression, name: string): boolean {
  return ts.isPropertyAccessExpression(callee) && callee.expression.getText().endsWith("classList") && CLASS_CALLEES.has(name);
}

function isSafeCallee(node: ts.CallLikeExpression): boolean {
  const callee = ts.isCallExpression(node) || ts.isNewExpression(node) ? node.expression : null;
  if (callee === null) return false;
  const name = calleeNameOf(callee);
  return SAFE_CALLEES.has(name) || isClassListCall(callee, name);
}

function isComparison(parent: ts.Node): boolean {
  if (!ts.isBinaryExpression(parent)) return false;
  return [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(parent.operatorToken.kind);
}

function isStructuralParent(parent: ts.Node): boolean {
  return ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isLiteralTypeNode(parent) || ts.isCaseClause(parent);
}

function isStructural(node: ts.Node): boolean {
  const parent = node.parent;
  if (isStructuralParent(parent)) return true;
  if (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isEnumMember(parent)) return parent.name === node;
  if (ts.isElementAccessExpression(parent)) return parent.argumentExpression === node;
  return isComparison(parent);
}

function isInsideSafeCall(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current !== undefined; current = current.parent) {
    if ((ts.isCallExpression(current) || ts.isNewExpression(current)) && isSafeCallee(current)) return true;
    if (ts.isFunctionLike(current) || ts.isBlock(current)) return false;
  }
  return false;
}

function isClassList(text: string, vocabulary: ScanVocabulary): boolean {
  const tokens = text.split(/\s+/).filter((token) => token !== "");
  return tokens.every((token) => vocabulary.classNames.has(token) || /^[a-z][a-z0-9_:-]*$/.test(token) && /[-_:0-9]/.test(token));
}

function wordsOf(text: string): string[] {
  return text.match(WORD) ?? [];
}

function isNotProse(trimmed: string, vocabulary: ScanVocabulary): boolean {
  return trimmed === "" || vocabulary.notTextLiterals.has(trimmed) || NOT_PROSE.test(trimmed) || SELECTOR.test(trimmed);
}

function singleWordReadsAsText(trimmed: string): boolean {
  return /^[A-Z][a-z]{2,}$/.test(trimmed) || /^[A-Z].*[.!?…]$/.test(trimmed);
}

function phraseReadsAsText(trimmed: string, words: ReadonlyArray<string>): boolean {
  return words.length >= 2 || /^[A-Z]/.test(trimmed) || words.some((word) => STOP_WORDS.has(word.toLowerCase()));
}

function readsAsText(text: string, vocabulary: ScanVocabulary, isTemplatePart: boolean): boolean {
  const trimmed = text.trim();
  if (isNotProse(trimmed, vocabulary)) return false;
  const words = wordsOf(trimmed).filter((word) => !vocabulary.notTextWords.has(word));
  if (words.length === 0) return false;
  if (NON_ASCII_LETTER.test(trimmed)) return true;
  if (isTemplatePart && words.some((word) => word.length >= 3)) return true;
  if (!/\s/.test(trimmed)) return singleWordReadsAsText(trimmed);
  return !isClassList(trimmed, vocabulary) && phraseReadsAsText(trimmed, words);
}

function textOfLiteral(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text;
  return null;
}

function offenceOf(source: ts.SourceFile, node: ts.Node, vocabulary: ScanVocabulary): Offence | null {
  const text = textOfLiteral(node);
  if (text === null || isStructural(node) || isInsideSafeCall(node) || !readsAsText(text, vocabulary, ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))) return null;
  return { line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text };
}

/** Every literal in the source text that reads as user-facing English, in file order. */
export function offencesIn(fileName: string, sourceText: string, vocabulary: ScanVocabulary): Offence[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const found: Offence[] = [];
  const visit = (node: ts.Node): void => {
    const offence = offenceOf(source, node, vocabulary);
    if (offence !== null) found.push(offence);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
