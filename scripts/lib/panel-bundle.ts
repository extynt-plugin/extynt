// Turns the panel's TypeScript module graph into classic-script text: types are stripped in place, module syntax becomes loader calls.
import { readFileSync, statSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { ROOT } from "./sources.ts";

interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface PanelModule {
  readonly file: string;
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
}

interface EditCollection {
  readonly file: string;
  readonly sourceFile: ts.SourceFile;
  readonly edits: TextEdit[];
  readonly exported: string[];
}

function moduleId(file: string): string {
  return relative(ROOT, file).replaceAll("\\", "/").replace(/\.ts$/, "");
}

function workspacePackageEntry(specifier: string): string | null {
  const match = /^@extynt\/([a-z-]+)$/.exec(specifier);
  return match?.[1] ? join(ROOT, "packages", match[1], "src", "index.ts") : null;
}

function requestedModule(specifier: string): string {
  const packageEntry = workspacePackageEntry(specifier);
  return packageEntry ? moduleId(packageEntry) : specifier;
}

function isFile(candidate: string): boolean {
  try { return statSync(candidate).isFile(); } catch { return false; }
}

function resolveImport(from: string, specifier: string): string {
  const packageEntry = workspacePackageEntry(specifier);
  if (packageEntry) return packageEntry;
  if (!specifier.startsWith(".")) throw new Error(`Panel runtime import must be local: ${specifier}`);
  const base = resolve(dirname(from), specifier.replace(/\.js$/, ""));
  const found = [base, `${base}.ts`, join(base, "index.ts")].find(isFile);
  if (!found) throw new Error(`Cannot resolve panel runtime import ${specifier} from ${from}`);
  return found;
}

function fail(file: string, detail: string): never {
  throw new Error(`Panel runtime module ${moduleId(file)}: ${detail}`);
}

function specifierText(file: string, specifier: ts.Expression): string {
  return ts.isStringLiteral(specifier) ? specifier.text : fail(file, "a module specifier is not a string literal");
}

function importCode(statement: ts.ImportDeclaration, file: string): string {
  const request = `require(${JSON.stringify(requestedModule(specifierText(file, statement.moduleSpecifier)))})`;
  const clause = statement.importClause;
  if (!clause) return `${request};`;
  if (clause.isTypeOnly) return "";
  if (clause.name) fail(file, "default imports are not supported");
  const bindings = clause.namedBindings;
  if (!bindings) return `${request};`;
  if (ts.isNamespaceImport(bindings)) return `var ${bindings.name.text} = ${request};`;
  const names = bindings.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => (element.propertyName ? `${element.propertyName.text}: ${element.name.text}` : element.name.text));
  return names.length > 0 ? `var { ${names.join(", ")} } = ${request};` : `${request};`;
}

function requirePrefix(file: string, specifier: ts.Expression | undefined): string {
  return specifier && ts.isStringLiteral(specifier) ? `require(${JSON.stringify(requestedModule(specifierText(file, specifier)))}).` : "";
}

function exportCode(statement: ts.ExportDeclaration, file: string): string {
  if (statement.isTypeOnly) return "";
  const clause = statement.exportClause;
  if (!clause) return fail(file, "export * is not supported");
  if (ts.isNamespaceExport(clause)) return fail(file, "export * as ns is not supported");
  const prefix = requirePrefix(file, statement.moduleSpecifier);
  return clause.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => `exports.${(element.propertyName ?? element.name).text} = ${prefix}${element.name.text};`)
    .join("\n");
}

function exportedNames(statement: ts.Statement, file: string): string[] {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    if (!statement.name) fail(file, "an exported declaration has no name");
    return [statement.name.text];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map((declaration) => {
      if (!ts.isIdentifier(declaration.name)) fail(file, "an exported binding is destructured");
      return declaration.name.text;
    });
  }
  return fail(file, `exported ${ts.SyntaxKind[statement.kind]} declarations are not supported`);
}

function isTypeOnlyDeclaration(statement: ts.Statement): boolean {
  return ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isModuleDeclaration(statement);
}

function declarationEdits(statement: ts.Statement, collected: EditCollection): void {
  const { file, sourceFile, edits, exported } = collected;
  if (isTypeOnlyDeclaration(statement)) return;
  if (ts.isExportAssignment(statement)) fail(file, "export default / export = is not supported");
  const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
  if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)) return;
  const keyword = modifiers.find((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  if (!keyword) return;
  if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) fail(file, "export default is not supported");
  edits.push({ start: keyword.getStart(sourceFile), end: keyword.end, text: "" });
  exported.push(...exportedNames(statement, file));
}

function applyEdits(text: string, edits: ReadonlyArray<TextEdit>): string {
  let result = text;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

function statementEdit(statement: ts.Statement, collected: EditCollection): void {
  const { file, sourceFile, edits } = collected;
  const start = statement.getStart(sourceFile);
  if (ts.isImportDeclaration(statement)) edits.push({ start, end: statement.end, text: importCode(statement, file) });
  else if (ts.isExportDeclaration(statement)) edits.push({ start, end: statement.end, text: exportCode(statement, file) });
  else declarationEdits(statement, collected);
}

function emitModule(module: PanelModule): string {
  const { file, source, sourceFile } = module;
  const stripped = stripTypeScriptTypes(source, { mode: "strip" });
  if (stripped.length !== source.length) fail(file, "type stripping did not preserve the file layout");
  const collected: EditCollection = { file, sourceFile, edits: [], exported: [] };
  for (const statement of sourceFile.statements) statementEdit(statement, collected);
  if (collected.exported.length > 0) {
    const assignments = collected.exported.map((name) => `exports.${name} = ${name};`).join("\n");
    collected.edits.push({ start: sourceFile.end, end: sourceFile.end, text: `\n${assignments}\n` });
  }
  return applyEdits(stripped, collected.edits);
}

function runtimeSpecifiers(module: PanelModule): string[] {
  const { file, sourceFile } = module;
  return sourceFile.statements.flatMap((statement) => {
    if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) return [specifierText(file, statement.moduleSpecifier)];
    const reexport = ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier;
    return reexport ? [specifierText(file, statement.moduleSpecifier)] : [];
  });
}

function readModule(file: string): PanelModule {
  const source = readFileSync(file, "utf8");
  return { file, source, sourceFile: ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS) };
}

function collectInto(modules: Map<string, PanelModule>, file: string): void {
  const id = moduleId(file);
  if (modules.has(id)) return;
  const module = readModule(file);
  modules.set(id, module);
  for (const specifier of runtimeSpecifiers(module)) collectInto(modules, resolveImport(file, specifier));
}

/** Every module reachable from `entry` through runtime imports, as module id -> emitted classic-script code, in first-visit order. */
export function bundleModules(entry: string): ReadonlyMap<string, string> {
  const modules = new Map<string, PanelModule>();
  collectInto(modules, entry);
  return new Map([...modules].map(([id, module]) => [id, emitModule(module).replace(/[ \t]+$/gm, "").trimEnd()]));
}

/** The module id the bundle loader starts from for this entry file. */
export function entryModuleId(entry: string): string {
  return moduleId(entry);
}
