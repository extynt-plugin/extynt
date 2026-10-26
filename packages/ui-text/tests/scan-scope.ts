/** What the hard-coded English rule scans, read from the repository: the panel's runtime, the sidecar modules each domain lists, and the vocabulary that tells words from class names. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ScanVocabulary } from "./literal-scan.js";

const PANEL_RUNTIME = "apps/panel/runtime";
const SCOPES = "packages/ui-text/scopes";
const STYLE_DIRECTORIES = ["apps/panel/styles", "apps/panel"];

function scopeLines(prefix: string): string[] {
  const names = readdirSync(SCOPES).filter((name) => name.startsWith(prefix) && name.endsWith(".txt"));
  return names.flatMap((name) => linesOf(join(SCOPES, name)));
}

function linesOf(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").map((line) => line.split(" # ")[0]?.trim() ?? "").filter((line) => line !== "");
}

function sourcesUnder(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => sourcesUnder(join(path, name))).filter((file) => file.endsWith(".ts"));
}

function classNamesIn(text: string): string[] {
  const fromStyles = [...text.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1] ?? "");
  const fromMarkup = [...text.matchAll(/class="([^"]*)"/g)].flatMap((match) => (match[1] ?? "").split(/\s+/));
  return [...fromStyles, ...fromMarkup].filter((name) => name !== "");
}

function stylesheets(): string[] {
  const files = STYLE_DIRECTORIES.flatMap((directory) => (existsSync(directory) ? readdirSync(directory).map((name) => join(directory, name)) : []));
  const nested = existsSync("apps/panel/styles/components") ? readdirSync("apps/panel/styles/components").map((name) => join("apps/panel/styles/components", name)) : [];
  return [...files, ...nested].filter((file) => file.endsWith(".css") || file.endsWith(".html"));
}

/** The panel runtime files the rule covers: every file there except those listed in scopes/panel-exempt*.txt. */
export function panelFiles(): string[] {
  const exempt = new Set(scopeLines("panel-exempt"));
  return sourcesUnder(PANEL_RUNTIME).filter((file) => !exempt.has(file));
}

/** The sidecar files the rule covers: every path or directory listed in a scopes/sidecar-*.txt file, one file per domain. */
export function sidecarFiles(): string[] {
  return [...new Set(scopeLines("sidecar-").flatMap(sourcesUnder))].sort();
}

/** The class names, words and literals (scopes/not-text-words*.txt and not-text-literals*.txt, one entry per line, with a reason after " # ") the rule treats as not being user text. */
export function scanVocabulary(): ScanVocabulary {
  const classNames = new Set(stylesheets().flatMap((file) => classNamesIn(readFileSync(file, "utf8"))));
  return { classNames, notTextWords: new Set(scopeLines("not-text-words")), notTextLiterals: new Set(scopeLines("not-text-literals")) };
}
