// Banned-token checks: no in-source suppressions in any language, plus the After Effects host-boundary and type-erasure bans for native code.
// Patterns are assembled from fragments so this file never contains a banned token literally.
import { SDK_WRAPPER_FILE } from "./native-wrapper-tidy.ts";
import type { SourceEntry } from "./source-entry.ts";

type TokenBan = readonly [name: string, pattern: RegExp, reason: string];
type FileRule = readonly [applies: (key: string) => boolean, check: (entry: SourceEntry) => string[]];

interface Suppression {
  readonly name: string;
  readonly pattern: RegExp;
}

const join = (...parts: ReadonlyArray<string>): string => parts.join("");

const SUPPRESSIONS: ReadonlyArray<Suppression> = [
  { name: join("NO", "LINT"), pattern: new RegExp(join("NO", "LINT")) },
  { name: join("eslint", "-disable"), pattern: new RegExp(join("eslint", "-disable")) },
  { name: join("eslint", "-enable"), pattern: new RegExp(join("eslint", "-enable")) },
  { name: join("@ts", "-ignore"), pattern: new RegExp(join("@ts", "-ignore")) },
  { name: join("@ts", "-expect-error"), pattern: new RegExp(join("@ts", "-expect-error")) },
  { name: join("@ts", "-nocheck"), pattern: new RegExp(join("@ts", "-nocheck")) },
  { name: join("shellcheck", " disable"), pattern: new RegExp(join("shellcheck\\s+", "disable")) },
];

const MAIN_THREAD_BANS: ReadonlyArray<TokenBan> = [
  ["runModal", /\brunModal\b/, "runs a nested event loop on AE's main thread"],
  ["runModalForWindow", /\brunModalForWindow\b/, "runs a nested event loop on AE's main thread"],
  ["beginSheetModalForWindow", /\bbeginSheetModalForWindow\b/, "runs a nested event loop on AE's main thread"],
  ["NSAlert", /\bNSAlert\b/, "alerts run a nested event loop on AE's main thread"],
  ["sleep", /\b(?:sleep|usleep|nanosleep|sleep_for|sleep_until)\b/, "blocks AE's main thread"],
  ["dispatch_sync", /\bdispatch_sync\b/, "a synchronous hop onto the main queue can deadlock AE's main thread"],
  ["nextEventMatchingMask", /\bnextEventMatchingMask\b/, "pumping events by hand runs a nested event loop on AE's main thread"],
];

const OWNERSHIP_BANS: ReadonlyArray<TokenBan> = [
  ["new", /\bnew\s+(?:\(\s*std::nothrow\s*\)\s*)?[A-Za-z_:]/, "raw owning new; use a container, smart pointer or RAII wrapper"],
  ["delete", /(?<!=\s*)\bdelete\s*(?:\[\s*\])?\s*[A-Za-z_(*]/, "raw owning delete; use a container, smart pointer or RAII wrapper"],
  ["malloc/free", /\b(?:malloc|calloc|realloc|free)\s*\(/, "C allocation; use a container, smart pointer or RAII wrapper"],
];

const VOID_POINTER_BAN: TokenBan = [
  "void*",
  /\bvoid\s*\*/,
  "erases the type; use a typed pointer, a template or std::variant (a sdk_* wrapper file may write it only as a named parameter of a declared function or an out-parameter local `void* name = nullptr;` whose address is passed on, never as an alias, member, return type or cast target)",
];

const TYPE_ERASURE_BANS: ReadonlyArray<TokenBan> = [
  ["std::any", /\bstd::any\b|#\s*include\s*<any>/, "erases the type; use std::variant or a struct"],
];

const VARARG_BANS: ReadonlyArray<TokenBan> = [
  ["printf family", /\b[A-Za-z_]*(?:printf|scanf)(?:_s)?\b|\bwsprintf[AW]?\b/, "is a C vararg function, called or referenced; build the text with std::string, std::to_chars or std::ostringstream, and parse with std::from_chars or std::istringstream (only a sdk_* wrapper file may use a platform vararg function)"],
  ["va_list", /\bva_(?:list|start|end|arg|copy)\b|__VA_ARGS__/, "writes a C variadic function or macro; take a typed parameter or a template parameter pack (only a sdk_* wrapper file may adapt a platform variadic signature)"],
  ["vararg function pointer", /\(\s*\*[^()]*\)\s*\((?:[^()]*,)?\s*\.\.\.\s*\)/, "is a pointer to a vararg function; calling through it hides a vararg call from the tidy check"],
];

const CAST_BANS: ReadonlyArray<TokenBan> = [
  ["reinterpret_cast", /\breinterpret_cast\b/, "is allowed only in sdk_* wrapper files (ae/, transport/, catalogue-window/), where the platform forces it"],
  ["const_cast", /\bconst_cast\b/, "is allowed only in sdk_* wrapper files (ae/, transport/, catalogue-window/), where the platform forces it"],
];

const PANEL_BANS: ReadonlyArray<TokenBan> = [
  ["__adobe_cep__", /__adobe_cep__/, "is a CEP host object; the panel talks to the sidecar only"],
  ["cep.fs", /\bcep\.fs\b/, "is CEP file access; the sidecar owns files"],
  ["evalScript", /\bevalScript\b/, "is a CEP host call; everything the panel did in After Effects is a sidecar API call"],
  ["CSInterface", /\bCSInterface\b/, "is the CEP interface library"],
  ["getSystemPath", /\bgetSystemPath\b/, "is a CEP path lookup"],
  ["localStorage", /\blocalStorage\b/, "persists in the page; sessions and prefs live in the sidecar store"],
  ["sessionStorage", /\bsessionStorage\b/, "persists in the page; the endpoint and token come from the host"],
  ["indexedDB", /\bindexedDB\b/, "persists in the page; the sidecar owns stored data"],
  ["alert(", /\balert\s*\(/, "opens a modal dialog on AE's main thread"],
  ["confirm(", /\bconfirm\s*\(/, "opens a modal dialog on AE's main thread"],
  ["prompt(", /\bprompt\s*\(/, "opens a modal dialog on AE's main thread"],
];

const PRODUCT_NAME_BAN: TokenBan = [join("Ext", "ynt"), new RegExp(join("Ext", "ynt")), "is the product name capitalised; it is always lowercase"];
const UNTYPED_ALIAS_BAN: TokenBan = [join("Untr", "usted"), new RegExp(`\\b${join("Untr", "usted")}\\b`), "is an alias for unknown; take a JsonValue from @extynt/decode or an exact type"];
const TS_FILE = /\.(?:ts|tsx)$/;
const PRODUCT_NAME_FILE = /^(?:apps\/(?:sidecar\/src|panel\/(?:runtime|host))|packages\/[^/]+\/src)\/.+\.(?:ts|jsx)$|^native\/extynt-core\/.+\.(?:cpp|h|mm)$/;
const PANEL_RUNTIME_FILE = /^apps\/panel\/runtime\/.+\.ts$/;
const CPP_FILE = /\.(?:cpp|h|m|mm)$/;
const NATIVE_FILE = /^native\/extynt-core\/.+\.(?:cpp|h|mm)$/;
const AE_FILE = /^native\/extynt-core\/ae\/.+\.(?:cpp|h|mm)$/;

/** Source text with comments and string/char literals blanked (newlines kept), so token bans see code only. */
export function stripCppLiterals(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|R"([^(\s]*)\([\s\S]*?\)\1"|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (match: string) => match.replace(/[^\n]/g, " "));
}

function lineOfIndex(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function suppressionFailures({ key, text }: SourceEntry): string[] {
  const failures: string[] = [];
  for (const { name, pattern } of SUPPRESSIONS) {
    const found = pattern.exec(text);
    if (found) failures.push(`${key}:${lineOfIndex(text, found.index)}: ${name} is not allowed; there is no exception mechanism, fix the code`);
  }
  return failures;
}

function tokenBanFailures({ key, text }: SourceEntry, bans: ReadonlyArray<TokenBan>): string[] {
  const code = stripCppLiterals(text);
  const failures: string[] = [];
  for (const [name, pattern, reason] of bans) {
    const global = new RegExp(pattern.source, "g");
    for (const found of code.matchAll(global)) failures.push(`${key}:${lineOfIndex(code, found.index)}: ${name} ${reason}`);
  }
  return failures;
}

function panelBanFailures({ key, text }: SourceEntry): string[] {
  const failures: string[] = [];
  for (const [name, pattern, reason] of PANEL_BANS) {
    const found = new RegExp(pattern.source, "g");
    for (const match of text.matchAll(found)) failures.push(`${key}:${lineOfIndex(text, match.index)}: ${name} ${reason}`);
  }
  return failures;
}

function productNameFailures({ key, text }: SourceEntry): string[] {
  const [name, pattern, reason] = PRODUCT_NAME_BAN;
  return [...text.matchAll(new RegExp(pattern.source, "g"))].map((found) => `${key}:${lineOfIndex(text, found.index)}: ${name} ${reason}`);
}

const isCastRestricted = (key: string): boolean => CPP_FILE.test(key) && !SDK_WRAPPER_FILE.test(key);
const isWrapper = (key: string): boolean => CPP_FILE.test(key) && SDK_WRAPPER_FILE.test(key);

const OUT_PARAMETER_LOCAL = /(?<=[;{}]\s*(?:const\s+)?)void(?=\s*\*+\s*([A-Za-z_]\w*)\s*=\s*nullptr\s*;)/g;
const NAMED_PARAMETER = /(?<=[(,]\s*(?:const\s+)?)void(?=\s*\*+\s*(?:const\s+)?[A-Za-z_]\w*\s*[,)=])/g;
const TYPE_BODY_PREFIX = /\b(?:struct|class|union|enum|namespace)\b[^;{}()]*$/;
const NOT_A_FUNCTION = new Set(["sizeof", "alignof", "alignas", "decltype", "typeof", "if", "while", "for", "switch", "catch", "return", "noexcept", "static_assert", "__attribute__", "__declspec"]);

function unmatchedBefore(code: string, index: number, open: string, close: string): number {
  let depth = 0;
  for (let position = index - 1; position >= 0; position -= 1) {
    if (code.charAt(position) === close) depth += 1;
    if (code.charAt(position) === open && depth === 0) return position;
    if (code.charAt(position) === open) depth -= 1;
  }
  return -1;
}

function blockEnd(code: string, open: number): number {
  let depth = 0;
  for (let position = open; position < code.length; position += 1) {
    if (code.charAt(position) === "{") depth += 1;
    if (code.charAt(position) === "}") depth -= 1;
    if (depth === 0) return position;
  }
  return code.length;
}

function isOutParameterLocal(code: string, found: RegExpExecArray): boolean {
  const open = unmatchedBefore(code, found.index, "{", "}");
  if (open < 0 || TYPE_BODY_PREFIX.test(code.slice(0, open))) return false;
  return new RegExp(`&\\s*${found[1] ?? ""}\\b`).test(code.slice(found.index, blockEnd(code, open)));
}

function isDeclaredParameter(code: string, found: RegExpExecArray): boolean {
  const open = unmatchedBefore(code, found.index, "(", ")");
  const callee = open < 0 ? undefined : /([A-Za-z_]\w*)\s*$/.exec(code.slice(0, open))?.[1];
  return callee !== undefined && !NOT_A_FUNCTION.has(callee);
}

function allowedVoidPointers(code: string): Set<number> {
  const locals = [...code.matchAll(OUT_PARAMETER_LOCAL)].filter((found) => isOutParameterLocal(code, found));
  const parameters = [...code.matchAll(NAMED_PARAMETER)].filter((found) => isDeclaredParameter(code, found));
  return new Set([...locals, ...parameters].map((found) => found.index));
}

function wrapperVoidPointerFailures({ key, text }: SourceEntry): string[] {
  const code = stripCppLiterals(text);
  const allowed = allowedVoidPointers(code);
  const [name, pattern, reason] = VOID_POINTER_BAN;
  return [...code.matchAll(new RegExp(pattern.source, "g"))]
    .filter((found) => !allowed.has(found.index))
    .map((found) => `${key}:${lineOfIndex(code, found.index)}: ${name} ${reason}`);
}

const FILE_RULES: ReadonlyArray<FileRule> = [
  [(key) => PRODUCT_NAME_FILE.test(key), productNameFailures],
  [(key) => TS_FILE.test(key), (entry) => tokenBanFailures(entry, [UNTYPED_ALIAS_BAN])],
  [(key) => PANEL_RUNTIME_FILE.test(key), panelBanFailures],
  [(key) => NATIVE_FILE.test(key), (entry) => tokenBanFailures(entry, OWNERSHIP_BANS)],
  [(key) => CPP_FILE.test(key), (entry) => tokenBanFailures(entry, TYPE_ERASURE_BANS)],
  [isCastRestricted, (entry) => tokenBanFailures(entry, [...CAST_BANS, VOID_POINTER_BAN, ...VARARG_BANS])],
  [isWrapper, wrapperVoidPointerFailures],
  [(key) => AE_FILE.test(key), (entry) => tokenBanFailures(entry, MAIN_THREAD_BANS)],
];

/** Every banned-token failure for the given {key, text} entries (key is the repo-relative path). */
export function bannedTokenFailures(entries: ReadonlyArray<SourceEntry>): string[] {
  return entries.flatMap((entry) => [
    ...suppressionFailures(entry),
    ...FILE_RULES.filter(([applies]) => applies(entry.key)).flatMap(([, check]) => check(entry)),
  ]);
}
