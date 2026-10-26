/**
 * Loads the ExtendScript host files the way After Effects does: an entry file, then the parts it
 * `$.evalFile`s at top level, all in one global scope. The part list is read from the entry itself, so
 * a harness cannot drift from the load order the host uses.
 */

import { readFileSync } from "node:fs";
import vm from "node:vm";

const PANEL_ROOT = "apps/panel";
const LOAD_STATEMENT = /\$\.evalFile\(new File\(aeHostDirectory \+ "\/([A-Za-z0-9._-]+\.jsx)"\)\)/g;
const SIBLING_ENTRIES: ReadonlySet<string> = new Set(["collection.jsx", "catalogue.jsx"]);

const ES3_MISSING_BUILT_INS: ReadonlyArray<readonly [owner: string, names: readonly string[]]> = [
  ["Array", ["isArray", "from", "of"]],
  ["Array.prototype", ["indexOf", "lastIndexOf", "forEach", "map", "filter", "some", "every", "reduce", "reduceRight", "includes", "find", "findIndex", "fill", "flat", "flatMap", "at"]],
  ["Object", ["keys", "values", "entries", "assign", "create", "freeze", "getPrototypeOf", "getOwnPropertyNames"]],
  ["String.prototype", ["trim", "trimStart", "trimEnd", "includes", "startsWith", "endsWith", "padStart", "padEnd", "repeat", "at"]],
  ["Date", ["now"]],
  ["Function.prototype", ["bind"]],
];

const ES3_STRIP_SCRIPT = ES3_MISSING_BUILT_INS.flatMap(([owner, names]) => names.map((name) => `delete ${owner}[${JSON.stringify(name)}];`)).join("\n");

function hostFile(name: string, panelRoot: string): string {
  return readFileSync(`${panelRoot}/host/${name}`, "utf8");
}

type RealmIntrinsic = ArrayConstructor | ObjectConstructor | StringConstructor | DateConstructor | FunctionConstructor;

function sharesRealmIntrinsics(context: vm.Context): boolean {
  const isOwn = (name: string, intrinsic: RealmIntrinsic): boolean => vm.runInContext(name, context) === intrinsic;
  return isOwn("Array", Array) || isOwn("Object", Object) || isOwn("String", String) || isOwn("Date", Date) || isOwn("Function", Function);
}

/** The parts `entry` loads, in load order; sibling entries are left to their own call. */
export function hostPartNames(entry: string, panelRoot = PANEL_ROOT): string[] {
  const names = Array.from(hostFile(entry, panelRoot).matchAll(LOAD_STATEMENT), (match) => match[1]);
  return names.filter((name): name is string => name !== undefined && !SIBLING_ENTRIES.has(name));
}

function hostFileNames(entry = "probe.jsx", panelRoot = PANEL_ROOT): string[] {
  return [entry, ...hostPartNames(entry, panelRoot)];
}

/** One text for `entry` and its parts, for assertions that read what the host script says. */
export function hostText(entry = "probe.jsx", panelRoot = PANEL_ROOT): string {
  return hostFileNames(entry, panelRoot).map((name) => hostFile(name, panelRoot)).join("\n");
}

/**
 * Evaluates `entry` and its parts in `context`, as top-level statements of one global scope. `panelRoot` points at a
 * shipped payload's panel folder. ExtendScript is ES3, so the ES5+ built-ins After Effects lacks are removed from the
 * context's own intrinsics first (live AE 26: "Function AE_DERIVE_KINDS.indexOf is undefined"); JSON stays because
 * tests read results through it. A context handed this realm's own built-ins is left alone, so the strip never
 * reaches the test process itself.
 */
export function loadHostFiles(context: vm.Context, entry = "probe.jsx", panelRoot = PANEL_ROOT): void {
  if (!sharesRealmIntrinsics(context)) vm.runInContext(ES3_STRIP_SCRIPT, context);
  for (const name of hostFileNames(entry, panelRoot)) vm.runInContext(hostFile(name, panelRoot), context, { filename: `${panelRoot}/host/${name}` });
}

/** A host function by name as a typed text-in, text-out call evaluated in `context`. */
export function hostTextFunction(context: vm.Context, name: string): (raw: string) => string {
  return (raw) => String(vm.runInContext(`${name}(${JSON.stringify(raw)})`, context));
}
