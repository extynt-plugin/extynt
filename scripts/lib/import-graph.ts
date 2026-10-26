// Import graph, layering rules and cycle detection for the maintained sources.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { decodeJson, jsonValue, object, optional, record, string } from "@extynt/decode";
import ts from "typescript";
import { parseSource } from "./measure.ts";
import { packageNameOf } from "./module-resolution.ts";
import { WORKSPACE_PACKAGES, rel, statFile, workspaceRoots } from "./sources.ts";
import type { WorkspacePackage } from "./sources.ts";

interface ImportSpec {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

type Graph = Map<string, string[]>;

interface ComponentState {
  readonly order: Map<string, number>;
  readonly low: Map<string, number>;
  readonly onStack: Set<string>;
  readonly stack: string[];
  readonly cyclic: Set<string>;
  counter: number;
}

interface DependencyCheck {
  readonly rootName: string;
  readonly packageDirectory: string;
  readonly target: WorkspacePackage;
  readonly dependency: string;
}

const dependencyTable = optional(record(string(), jsonValue));
const manifestDependencies = object({ dependencies: dependencyTable, devDependencies: dependencyTable, peerDependencies: dependencyTable });

function rootOf(path: string): string {
  return path.split("/")[0] ?? "";
}

function isTypeOnlyClause(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false;
  if (clause.isTypeOnly === true) return true;
  const bindings = clause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings) || bindings.elements.length === 0) return false;
  return bindings.elements.every((element) => element.isTypeOnly);
}

function importDeclarationSpec(node: ts.Node): ImportSpec | null {
  if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return null;
  return { specifier: node.moduleSpecifier.text, typeOnly: isTypeOnlyClause(node.importClause) };
}

function importEqualsSpec(node: ts.Node): ImportSpec | null {
  if (!ts.isImportEqualsDeclaration(node) || !ts.isExternalModuleReference(node.moduleReference)) return null;
  const expression = node.moduleReference.expression;
  return ts.isStringLiteral(expression) ? { specifier: expression.text, typeOnly: false } : null;
}

function exportDeclarationSpec(node: ts.Node): ImportSpec | null {
  if (!ts.isExportDeclaration(node) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return null;
  return { specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly === true };
}

function dynamicImportSpec(node: ts.Node): ImportSpec | null {
  if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
  const [argument] = node.arguments;
  return node.arguments.length === 1 && argument && ts.isStringLiteral(argument) ? { specifier: argument.text, typeOnly: false } : null;
}

function importSpecifiers(source: ts.SourceFile): ImportSpec[] {
  const specs: ImportSpec[] = [];
  const visit = (node: ts.Node): void => {
    for (const spec of [importDeclarationSpec(node), importEqualsSpec(node), exportDeclarationSpec(node), dynamicImportSpec(node)]) {
      if (spec) specs.push(spec);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specs;
}

function workspaceCandidate(packageName: string, subpath: string): string | null {
  const workspace = WORKSPACE_PACKAGES.get(packageName);
  if (!workspace) return null;
  return resolve(workspace.directory, subpath || "src/index");
}

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else {
    const packageName = packageNameOf(specifier);
    const candidate = workspaceCandidate(packageName, specifier.slice(packageName.length).replace(/^\//, ""));
    if (!candidate) return null;
    base = candidate;
  }
  const withoutJs = base.endsWith(".js") || base.endsWith(".jsx") ? base.slice(0, -3) : base;
  const candidates = [
    base, withoutJs, `${withoutJs}.ts`, `${withoutJs}.tsx`, `${withoutJs}.js`,
    join(withoutJs, "index.ts"), join(withoutJs, "index.tsx"), join(withoutJs, "index.js"),
  ];
  return candidates.find(statFile) ?? null;
}

function popComponent(state: ComponentState, file: string): void {
  const component: string[] = [];
  for (let member = state.stack.pop(); member !== undefined; member = state.stack.pop()) {
    state.onStack.delete(member);
    component.push(member);
    if (member === file) break;
  }
  if (component.length > 1) for (const cyclicMember of component) state.cyclic.add(cyclicMember);
}

function lowerLow(state: ComponentState, file: string, candidate: number | undefined): void {
  state.low.set(file, Math.min(state.low.get(file) ?? Number.POSITIVE_INFINITY, candidate ?? Number.POSITIVE_INFINITY));
}

function visitTarget(state: ComponentState, graph: Graph, file: string, target: string): void {
  if (!state.order.has(target)) {
    connect(state, graph, target);
    lowerLow(state, file, state.low.get(target));
  } else if (state.onStack.has(target)) lowerLow(state, file, state.order.get(target));
}

function connect(state: ComponentState, graph: Graph, file: string): void {
  state.order.set(file, state.counter);
  state.low.set(file, state.counter);
  state.counter += 1;
  state.stack.push(file);
  state.onStack.add(file);
  for (const target of graph.get(file) ?? []) visitTarget(state, graph, file, target);
  if (state.low.get(file) === state.order.get(file)) popComponent(state, file);
}

function cycleFailures(files: ReadonlyArray<string>, graph: Graph): string[] {
  const state: ComponentState = { order: new Map(), low: new Map(), onStack: new Set(), stack: [], cyclic: new Set(), counter: 0 };
  for (const file of files) if (!state.order.has(file)) connect(state, graph, file);
  const offending = [...state.cyclic].map(rel).sort();
  return offending.length ? [`dependency cycle: ${offending.join(", ")}`] : [];
}

const ALLOWED_LAYERS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ["packages", ["packages"]],
  ["tools", ["packages", "tools"]],
  ["apps", ["packages", "apps", "tools"]],
]);
const BOUNDARY_NAMES: ReadonlyMap<string, string> = new Map([["packages", "package"], ["tools", "tool"], ["apps", "app"]]);

function layerFailure(sourceRoot: string, targetRoot: string, specifier: string): string | null {
  if (!BOUNDARY_NAMES.has(targetRoot) || sourceRoot === targetRoot) return null;
  if (ALLOWED_LAYERS.get(sourceRoot)?.includes(targetRoot)) return null;
  const sourceName = BOUNDARY_NAMES.get(sourceRoot);
  return sourceName ? `${sourceName} boundary import ${specifier}` : null;
}

function boundaryFailures(file: string, target: string | null, specifier: string): string[] {
  const sourceRel = rel(file);
  const targetRel = target ? rel(target) : "";
  const sourceRoot = rootOf(sourceRel);
  const targetRoot = rootOf(targetRel);
  const failure = layerFailure(sourceRoot, targetRoot, specifier);
  const failures = failure ? [`${sourceRel}: ${failure}`] : [];
  const sourceApp = sourceRel.split("/").slice(0, 2).join("/");
  const targetApp = targetRel.split("/").slice(0, 2).join("/");
  if (sourceRoot === "apps" && targetRoot === "apps" && sourceApp !== targetApp) failures.push(`${sourceRel}: app-to-app boundary import ${specifier}`);
  return failures;
}

function importFailures(files: ReadonlyArray<string>, known: ReadonlySet<string>, graph: Graph): string[] {
  const failures: string[] = [];
  for (const file of files) {
    const { source } = parseSource(file);
    for (const { specifier, typeOnly } of importSpecifiers(source)) {
      const target = resolveImport(file, specifier);
      if (target && known.has(target) && !typeOnly) graph.get(file)?.push(target);
      failures.push(...boundaryFailures(file, target, specifier));
    }
  }
  return failures;
}

const FORBIDDEN_DEPENDENCIES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["packages", new Set(["apps", "tools"])],
  ["tools", new Set(["apps"])],
  ["apps", new Set()],
]);

function dependencyFailure({ rootName, packageDirectory, target, dependency }: DependencyCheck): string | null {
  if (FORBIDDEN_DEPENDENCIES.get(rootName)?.has(target.root)) return `${BOUNDARY_NAMES.get(rootName) ?? rootName} dependency ${dependency} points to ${target.root}`;
  const otherApp = target.root === "apps" && target.relative !== rel(packageDirectory);
  return rootName === "apps" && otherApp ? `app dependency ${dependency} points to another app` : null;
}

function manifestFailuresOf(rootName: string, packageDirectory: string): string[] {
  const manifest = join(packageDirectory, "package.json");
  if (!statFile(manifest)) return [];
  const decoded = decodeJson(readFileSync(manifest, "utf8"), manifestDependencies);
  if (!decoded.ok) throw new Error(`${manifest}: not a package manifest`);
  const { dependencies, devDependencies, peerDependencies } = decoded.value;
  const names = Object.keys({ ...dependencies, ...devDependencies, ...peerDependencies });
  const failures = names.flatMap((dependency) => {
    const target = WORKSPACE_PACKAGES.get(dependency);
    return target ? [dependencyFailure({ rootName, packageDirectory, target, dependency })] : [];
  });
  return failures.flatMap((failure) => (failure ? [`${rel(manifest)}: ${failure}`] : []));
}

function manifestFailures(): string[] {
  return workspaceRoots().flatMap((root) => {
    const rootName = rootOf(rel(root));
    return readdirSync(root).flatMap((name) => manifestFailuresOf(rootName, join(root, name)));
  });
}

/** Every architecture failure across the maintained set; an empty array is the pass condition. */
export function architectureFailures(files: ReadonlyArray<string>): string[] {
  const known = new Set(files);
  const graph: Graph = new Map(files.map((file) => [file, []]));
  return [...importFailures(files, known, graph), ...manifestFailures(), ...cycleFailures(files, graph)];
}
