// Native include architecture and the After Effects boundary rules that can be checked by reading source.
import { stripCppLiterals } from "./banned-tokens.ts";
import type { SourceEntry } from "./source-entry.ts";

type Layer = "core" | "transport" | "ae" | "catalogue-window" | "tests";
type IncludeKind = "<" | '"';

interface Include {
  readonly line: number;
  readonly kind: IncludeKind;
  readonly path: string;
}

interface UnreadableCallback {
  readonly index: number;
  readonly name: string;
  readonly argument: string;
}

interface RegisteredCallbacks {
  readonly names: ReadonlySet<string>;
  readonly unreadable: readonly UnreadableCallback[];
}

interface Definition {
  readonly noexcept: boolean;
  readonly body: string;
  readonly index: number;
}

type LayersByBasename = ReadonlyMap<string, readonly Layer[]>;

const INCLUDE = /^[ \t]*#[ \t]*include[ \t]*([<"])([^>"]+)[>"]/gm;
const SDK_HEADER = /^(?:AE_|AEGP|A\.h$|SP\/|PF_|PR_|SPBasic|SPSuites|entry\.h$|adobesdk)/;
const NATIVE_ROOT = "native/extynt-core/";
const LAYERS: readonly Layer[] = ["core", "transport", "ae", "catalogue-window", "tests"];

function layerOf(key: string): Layer | null {
  const [first] = key.slice(NATIVE_ROOT.length).split("/");
  return LAYERS.find((layer) => layer === first) ?? null;
}

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function basenameLayers(keys: readonly string[]): LayersByBasename {
  const map = new Map<string, Layer[]>();
  for (const key of keys) {
    const layer = layerOf(key);
    if (layer) map.set(basenameOf(key), [...(map.get(basenameOf(key)) ?? []), layer]);
  }
  return map;
}

/** [{ line, kind: "<"|"\"", path }] for every include directive. */
export function includesOf(text: string): Include[] {
  return [...text.matchAll(INCLUDE)].map((found) => ({
    line: text.slice(0, found.index).split("\n").length,
    kind: found[1] === "<" ? "<" : '"',
    path: found[2] ?? "",
  }));
}

function isStandardLibrary(path: string): boolean { return !path.includes("/") && !path.endsWith(".h"); }

const ALLOWED_QUOTED: Readonly<Record<Layer, readonly Layer[]>> = {
  core: ["core"],
  transport: ["core", "transport"],
  "catalogue-window": ["core", "transport", "catalogue-window"],
  tests: ["core", "transport", "catalogue-window", "tests"],
  ae: LAYERS,
};

function quotedFailure(layer: Layer, include: Include, known: LayersByBasename): string | null {
  const base = basenameOf(include.path);
  if (base === "xxhash.h") return layer === "core" ? null : "includes xxhash; only core/ may use third_party/xxhash";
  const owners = known.get(base);
  if (!owners) return layer === "ae" ? null : `includes "${include.path}", which is not one of our headers`;
  return owners.some((owner) => ALLOWED_QUOTED[layer].includes(owner)) ? null : `includes ${owners[0]}/${base}, but ${layer}/ may include only ${ALLOWED_QUOTED[layer].join(", ")}`;
}

function angledFailure(layer: Layer, include: Include): string | null {
  if (layer === "core") return isStandardLibrary(include.path) ? null : `includes <${include.path}>; core/ is the C++ standard library only (no POSIX, OS or SDK headers)`;
  if (layer === "tests" && SDK_HEADER.test(include.path)) return `includes <${include.path}>; tests/ never include SDK headers`;
  return null;
}

function includeFailure(layer: Layer, include: Include, known: LayersByBasename): string | null {
  if (include.kind === "<") return angledFailure(layer, include);
  if (layer === "tests" && SDK_HEADER.test(include.path)) return `includes "${include.path}"; tests/ never include SDK headers`;
  return quotedFailure(layer, include, known);
}

function repeatedIncludes(includes: readonly Include[]): Include[] {
  const seen = new Set();
  return includes.filter((include) => {
    const id = `${include.kind}${include.path}`;
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
}

/** Include-layering failures for {key, text} entries of the native sources, and every include a file lists twice. */
export function includeFailures(entries: readonly SourceEntry[]): string[] {
  const known = basenameLayers(entries.map((entry) => entry.key));
  return entries.flatMap(({ key, text }) => {
    const layer = layerOf(key);
    if (!layer) return [];
    const includes = includesOf(text);
    const layering = includes.map((include) => ({ include, reason: includeFailure(layer, include, known) })).filter((item) => item.reason);
    const repeated = repeatedIncludes(includes).map((include) => ({ include, reason: `includes ${include.path} a second time` }));
    return [...layering, ...repeated].map((item) => `${key}:${item.include.line}: ${item.reason}`);
  });
}

function matchingBrace(code: string, open: number): number {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    if (code[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }
  return code.length - 1;
}

const CALLBACK_POSITION: ReadonlyMap<string, number> = new Map([["AEGP_RegisterCommandHook", 3], ["AEGP_RegisterCreatePanelHook", 2]]);
const HOOK_ADAPTER = /^(?:extynt::)?(?:ae::)?HookAdapter<\s*\w+\s*>::run<[^;]*>$/;
const PLAIN_IDENTIFIER = /^&?\s*(\w+)$/;

function closeBracket(stack: string[]): void {
  while (stack.at(-1) === "<") stack.pop();
  stack.pop();
}

function updateAngle(stack: string[], code: string, index: number): number {
  const next = code[index + 1];
  if (code[index] === "<") {
    if (next === "<" || next === "=") return 2;
    stack.push("<");
    return 1;
  }
  if (code[index - 1] === "-") return 1;
  if (next === "=") return 2;
  if (stack.at(-1) === "<") stack.pop();
  return 1;
}

function updateBrackets(stack: string[], code: string, index: number): number {
  const char = code.charAt(index);
  if (char === "<" || char === ">") return updateAngle(stack, code, index);
  if ("([{".includes(char)) stack.push(char);
  if (")]}".includes(char)) closeBracket(stack);
  return 1;
}

function callArguments(code: string, open: number): string[] {
  const args: string[] = [];
  const stack: string[] = [];
  let start = open + 1;
  for (let index = open; index < code.length;) {
    const char = code[index];
    const width = updateBrackets(stack, code, index);
    if (stack.length === 0) return [...args, code.slice(start, index).trim()];
    if (char === "," && stack.length === 1) {
      args.push(code.slice(start, index).trim());
      start = index + 1;
    }
    index += width;
  }
  return args;
}

function registeredCallbacks(code: string): RegisteredCallbacks {
  const names = new Set(["initializePlugin"]);
  const unreadable: UnreadableCallback[] = [];
  for (const found of code.matchAll(/\b(AEGP_Register\w*Hook)\s*\(/g)) {
    const open = found.index + found[0].length - 1;
    const hook = found[1] ?? "";
    const argument = callArguments(code, open)[CALLBACK_POSITION.get(hook) ?? 1] ?? "";
    const plain = PLAIN_IDENTIFIER.exec(argument)?.[1];
    if (plain) names.add(plain);
    else if (!HOOK_ADAPTER.test(argument.replace(/\s+/g, ""))) unreadable.push({ index: found.index, name: hook, argument });
  }
  return { names, unreadable };
}

function definitionOf(code: string, name: string): Definition | null {
  const definition = new RegExp(`\\b${name}\\s*\\([^;{}]*\\)\\s*(noexcept)?\\s*\\{`).exec(code);
  if (!definition) return null;
  const open = definition.index + definition[0].length - 1;
  return { noexcept: Boolean(definition[1]), body: code.slice(open, matchingBrace(code, open) + 1), index: definition.index };
}

/** Every callback registered with AE, and the function the entry point forwards to, must be noexcept and catch everything at its boundary. */
export function callbackFailures(entries: readonly SourceEntry[]): string[] {
  const failures: string[] = [];
  for (const { key, text } of entries.filter((entry) => /\/ae\/[^/]+\.(?:cpp|mm)$/.test(entry.key))) {
    const code = stripCppLiterals(text);
    const { names, unreadable } = registeredCallbacks(code);
    for (const item of unreadable) {
      failures.push(`${key}:${code.slice(0, item.index).split("\n").length}: ${item.name} is given \`${item.argument}\`; pass a plain function name or HookAdapter<Hook>::run<Call, handler> so the callback boundary can be checked`);
    }
    for (const name of names) {
      const found = definitionOf(code, name);
      if (!found) continue;
      const line = code.slice(0, found.index).split("\n").length;
      if (!found.noexcept) failures.push(`${key}:${line}: ${name} is registered with After Effects and must be declared noexcept`);
      if (!/catch\s*\(\s*\.\.\.\s*\)/.test(found.body)) failures.push(`${key}:${line}: ${name} must catch (...) at the After Effects boundary`);
    }
  }
  return [...failures, ...entryPointFailures(entries)];
}

const IDENTIFIER_LIST = String.raw`\w+(?:\s*,\s*\w+)*`;
const FORWARDS_AT_ONCE = new RegExp(String.raw`^\{\s*return\s+(?:\w+::)*initializePlugin\s*\(\s*(?:${IDENTIFIER_LIST}|\{\s*${IDENTIFIER_LIST}\s*\})\s*\)\s*;\s*\}$`);

function entryPointFailures(entries: readonly SourceEntry[]): string[] {
  const entry = entries.find((item) => item.key.endsWith("/ae/sdk_entry.cpp"));
  if (!entry) return [];
  const found = definitionOf(stripCppLiterals(entry.text), "EntryPointFunc");
  if (!found) return [`${entry.key}:1: EntryPointFunc is not defined; the PiPL names it and After Effects refuses to load the plugin without it`];
  const failures = found.noexcept ? [] : [`${entry.key}: EntryPointFunc is called by After Effects and must be declared noexcept`];
  if (!FORWARDS_AT_ONCE.test(found.body)) failures.push(`${entry.key}: EntryPointFunc must be exactly one return statement that forwards to initializePlugin; any other statement runs outside the catch (...) boundary`);
  return failures;
}
