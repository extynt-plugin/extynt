// The dead-exports stage: an exported symbol in a workspace package that nothing imports, and no public entry exposes, fails.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALL_EXPORTS, readModuleFacts } from "./module-facts.ts";
import type { ExportFact, ModuleFacts, ReexportFact, UseFact } from "./module-facts.ts";
import { entryPoints, readManifest, resolveFile, resolveSpecifier } from "./module-resolution.ts";
import type { PackageEntry, PackageTable } from "./module-resolution.ts";
import { WORKSPACE_PACKAGES, maintainedFiles, rel } from "./sources.ts";

const SOURCE_DIRECTORIES = ["src", "runtime"];
const SOURCE_FILE = /\.(?:ts|tsx|mts)$/;

interface SpecifierContext {
  readonly packages: PackageTable;
  readonly knownFiles: ReadonlySet<string>;
}

interface LinkedUse extends UseFact {
  readonly target: string;
}

interface LinkedReexport extends ReexportFact {
  readonly target: string;
}

interface LinkedFacts {
  readonly exports: ReadonlyArray<ExportFact>;
  readonly uses: ReadonlyArray<LinkedUse>;
  readonly reexports: ReadonlyArray<LinkedReexport>;
}

/** One exported name nothing imports. */
export interface DeadExport {
  readonly file: string;
  readonly line: number;
  readonly name: string;
}

/** The inputs of the analysis: every module's text, the workspace packages, and which files report their exports. */
export interface DeadExportInput {
  readonly texts: ReadonlyMap<string, string>;
  readonly packages: PackageTable;
  readonly isExporter: (file: string) => boolean;
}

interface Usage {
  readonly mark: (file: string, name: string) => void;
  readonly isUsed: (file: string, name: string) => boolean;
}

function packageTable(): PackageTable {
  const table = new Map<string, PackageEntry>();
  for (const [name, info] of WORKSPACE_PACKAGES) {
    table.set(name, { directory: info.directory, entries: entryPoints(readManifest(info.directory) ?? {}) });
  }
  return table;
}

function linkEntries<Entry extends { readonly specifier: string }>(entries: ReadonlyArray<Entry>, target: (specifier: string) => string | null) {
  return entries.flatMap((entry) => {
    const resolved = target(entry.specifier);
    return resolved ? [{ ...entry, target: resolved }] : [];
  });
}

function linkFacts(file: string, facts: ModuleFacts, context: SpecifierContext): LinkedFacts {
  const target = (specifier: string): string | null => resolveSpecifier({ specifier, importer: file, ...context });
  return { exports: facts.exports, uses: linkEntries(facts.uses, target), reexports: linkEntries(facts.reexports, target) };
}

function createUsage(modules: ReadonlyMap<string, LinkedFacts>): Usage {
  const used = new Set<string>();
  const everything = new Set<string>();
  const mark = (file: string, name: string): void => {
    if (name === ALL_EXPORTS) return markEverything(file);
    const key = `${file}\0${name}`;
    if (used.has(key)) return;
    used.add(key);
    for (const edge of modules.get(file)?.reexports ?? []) followEdge(edge, name);
  };
  const followEdge = (edge: LinkedReexport, name: string): void => {
    if (edge.exported === name && !edge.namespace) mark(edge.target, edge.imported);
    else if (edge.exported === ALL_EXPORTS && name !== "default") mark(edge.target, name);
    else if (edge.exported === name && edge.namespace) markEverything(edge.target);
  };
  const markEverything = (file: string): void => {
    if (everything.has(file)) return;
    everything.add(file);
    for (const edge of modules.get(file)?.reexports ?? []) mark(edge.target, edge.imported);
  };
  return { mark, isUsed: (file, name) => everything.has(file) || used.has(`${file}\0${name}`) };
}

function publicEntryFiles({ packages, knownFiles }: SpecifierContext): string[] {
  const targets = [...packages.values()].flatMap((info) => [...info.entries.values()].flat().map((target) => resolve(info.directory, target)));
  return targets.flatMap((target) => resolveFile(target, knownFiles) ?? []);
}

function exporterFiles(files: ReadonlyArray<string>): string[] {
  const roots = [...WORKSPACE_PACKAGES.values()].flatMap((info) => SOURCE_DIRECTORIES.map((name) => `${rel(join(info.directory, name))}/`));
  return files.filter((file) => SOURCE_FILE.test(file) && !file.endsWith(".d.ts") && roots.some((root) => rel(file).startsWith(root)));
}

function deadIn(file: string, facts: LinkedFacts | undefined, usage: Usage): DeadExport[] {
  const exported = facts?.exports ?? [];
  return exported.filter(({ name }) => !usage.isUsed(file, name)).map(({ name, line }) => ({ file, line, name }));
}

/** The unused exports of the given modules: { file, line, name } for each export of an exporter file nothing imports. */
export function findDeadExports({ texts, packages, isExporter }: DeadExportInput): DeadExport[] {
  const context: SpecifierContext = { packages, knownFiles: new Set(texts.keys()) };
  const modules = new Map([...texts].map(([file, text]) => [file, linkFacts(file, readModuleFacts(file, text), context)]));
  const usage = createUsage(modules);
  for (const facts of modules.values()) for (const entry of facts.uses) usage.mark(entry.target, entry.name);
  for (const file of publicEntryFiles(context)) usage.mark(file, ALL_EXPORTS);
  return [...texts.keys()].filter(isExporter).flatMap((file) => deadIn(file, modules.get(file), usage));
}

/** Dead-export failures for the maintained TS sources; `keep` limits which exporting files are reported. */
export function deadExportFailures(keep: (key: string) => boolean = () => true): string[] {
  const files = maintainedFiles();
  const texts = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
  const exporters = new Set(exporterFiles(files).filter((file) => keep(rel(file))));
  const dead = findDeadExports({ texts, packages: packageTable(), isExporter: (file) => exporters.has(file) });
  return dead.map(({ file, line, name }) => `${rel(file)}:${line}: export \`${name}\` is not imported anywhere; unexport it or delete it`);
}
