// Reads one source file's import and export facts: what it declares as exported, what it imports, what it re-exports.
import ts from "typescript";

export const ALL_EXPORTS = "*";

/** An exported name and the line it is declared on. */
export interface ExportFact {
  readonly name: string;
  readonly line: number;
}

/** A name imported from a module specifier; `ALL_EXPORTS` means the whole module. */
export interface UseFact {
  readonly specifier: string;
  readonly name: string;
}

/** A re-export edge: `imported` from the specifier is exposed as `exported`; `namespace` marks `export * as name`. */
export interface ReexportFact {
  readonly specifier: string;
  readonly imported: string;
  readonly exported: string;
  readonly namespace?: true;
}

/** Everything a file says about its own exports and its links to other modules. */
export interface ModuleFacts {
  readonly exports: ExportFact[];
  readonly uses: UseFact[];
  readonly reexports: ReexportFact[];
}

function literalText(node: ts.Node | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function bindingNames(name: ts.BindingName, found: ts.Identifier[]): ts.Identifier[] {
  if (ts.isIdentifier(name)) found.push(name);
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(element.name, found);
  return found;
}

function typeLevelName(statement: ts.Statement): ts.Node | undefined {
  const named = ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)
    || ts.isTypeAliasDeclaration(statement);
  return named ? statement.name : undefined;
}

function moduleLevelName(statement: ts.Statement): ts.Node | undefined {
  const named = ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement) || ts.isImportEqualsDeclaration(statement)
    || ts.isNamespaceExportDeclaration(statement);
  return named ? statement.name : undefined;
}

function declarationName(statement: ts.Statement): ts.Identifier | undefined {
  const name = typeLevelName(statement) ?? moduleLevelName(statement);
  return name && ts.isIdentifier(name) ? name : undefined;
}

function declaredNames(statement: ts.Statement): ts.Identifier[] {
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => bindingNames(declaration.name, []));
  const name = declarationName(statement);
  return name ? [name] : [];
}

function hasModifier(statement: ts.Statement, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === kind);
}

function atNode(source: ts.SourceFile, node: ts.Node, name: string): ExportFact {
  return { name, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 };
}

function localExportClause(statement: ts.Statement): ts.NamedExports | null {
  if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier) return null;
  const clause = statement.exportClause;
  return clause && ts.isNamedExports(clause) ? clause : null;
}

function ownExports(statement: ts.Statement, source: ts.SourceFile): ExportFact[] {
  if (ts.isExportAssignment(statement)) return statement.isExportEquals ? [] : [atNode(source, statement, "default")];
  const clause = localExportClause(statement);
  if (clause) return clause.elements.map((element) => atNode(source, element, element.name.text));
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return [];
  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return [atNode(source, statement, "default")];
  return declaredNames(statement).map((name) => atNode(source, name, name.text));
}

function namedImports(specifier: string, bindings: ts.NamedImportBindings): UseFact[] {
  if (ts.isNamespaceImport(bindings)) return [{ specifier, name: ALL_EXPORTS }];
  return bindings.elements.map((element) => ({ specifier, name: (element.propertyName ?? element.name).text }));
}

function importFacts(statement: ts.ImportDeclaration): UseFact[] {
  const specifier = literalText(statement.moduleSpecifier);
  const clause = statement.importClause;
  if (!specifier || !clause) return [];
  const defaults = clause.name ? [{ specifier, name: "default" }] : [];
  return clause.namedBindings ? [...defaults, ...namedImports(specifier, clause.namedBindings)] : defaults;
}

function reexportFacts(statement: ts.ExportDeclaration): ReexportFact[] {
  const specifier = literalText(statement.moduleSpecifier);
  const clause = statement.exportClause;
  if (!specifier) return [];
  if (!clause) return [{ specifier, imported: ALL_EXPORTS, exported: ALL_EXPORTS }];
  if (ts.isNamespaceExport(clause)) return [{ specifier, imported: ALL_EXPORTS, exported: clause.name.text, namespace: true }];
  return clause.elements.map((element) => ({ specifier, imported: (element.propertyName ?? element.name).text, exported: element.name.text }));
}

function dynamicUse(node: ts.Node): string | null {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return literalText(node.arguments[0]);
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") return literalText(node.arguments[0]);
  return ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) ? literalText(node.moduleReference.expression) : null;
}

function importTypeUse(node: ts.Node): UseFact | null {
  if (!ts.isImportTypeNode(node) || !ts.isLiteralTypeNode(node.argument)) return null;
  const specifier = literalText(node.argument.literal);
  const qualifier = node.qualifier && ts.isIdentifier(node.qualifier) ? node.qualifier.text : ALL_EXPORTS;
  return specifier ? { specifier, name: qualifier } : null;
}

function nestedUses(node: ts.Node, uses: UseFact[]): void {
  const specifier = dynamicUse(node);
  if (specifier) uses.push({ specifier, name: ALL_EXPORTS });
  const typed = importTypeUse(node);
  if (typed) uses.push(typed);
  ts.forEachChild(node, (child) => nestedUses(child, uses));
}

/** Facts of one file: own exports, imported names, re-export edges. Dynamic imports and require count as whole-module uses. */
export function readModuleFacts(file: string, text: string): ModuleFacts {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const facts: ModuleFacts = { exports: [], uses: [], reexports: [] };
  for (const statement of source.statements) {
    facts.exports.push(...ownExports(statement, source));
    if (ts.isImportDeclaration(statement)) facts.uses.push(...importFacts(statement));
    if (ts.isExportDeclaration(statement)) facts.reexports.push(...reexportFacts(statement));
  }
  if (/\bimport\s*[(.]|\brequire\s*\(|\bimport\s*\(/.test(text)) nestedUses(source, facts.uses);
  return facts;
}
