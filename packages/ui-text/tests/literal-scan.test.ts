/** The gate rule for the interface text: no panel or user-facing sidecar module holds a hard-coded English literal, and index.html carries its text through catalogue keys. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { isUiKey } from "../src/index.js";
import { offencesIn, type Offence } from "./literal-scan.js";
import { panelFiles, scanVocabulary, sidecarFiles } from "./scan-scope.js";

const vocabulary = scanVocabulary();

function report(files: ReadonlyArray<string>): string[] {
  const lines: string[] = [];
  for (const file of files) {
    const found: Offence[] = offencesIn(file, readFileSync(file, "utf8"), vocabulary);
    for (const offence of found) lines.push(`${file}:${offence.line}  ${JSON.stringify(offence.text)}`);
  }
  return lines;
}

const TEXT_ATTRIBUTES = ["title", "placeholder", "aria-label", "alt"];

function tagProblems(name: string, attributes: string, text: string): string[] {
  const problems: string[] = [];
  if (/\p{L}/u.test(text) && !/\bdata-i18n="/.test(attributes)) problems.push(`<${name}> text ${JSON.stringify(text.trim())} has no data-i18n`);
  for (const attribute of TEXT_ATTRIBUTES) {
    if (new RegExp(`\\s${attribute}="[^"]*\\p{L}`, "u").test(attributes) && !attributes.includes(`data-i18n-${attribute}=`)) problems.push(`<${name}> ${attribute} has no data-i18n-${attribute}`);
  }
  return problems;
}

function markupProblems(html: string): string[] {
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  return [...body.matchAll(/<(\w+)([^>]*)>([^<]*)/g)].flatMap(([, name = "", attributes = "", text = ""]) => tagProblems(name, attributes, text));
}

function unknownKeys(html: string): string[] {
  const named = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]*)"/g)].map((match) => match[1] ?? "");
  return named.filter((key) => !isUiKey(key));
}

const FULL_LIST = ".check-logs/literal-scan.txt";

function assertNone(scope: string, lines: ReadonlyArray<string>): void {
  mkdirSync(".check-logs", { recursive: true });
  if (lines.length > 0) writeFileSync(FULL_LIST.replace(".txt", `-${scope}.txt`), `${lines.join("\n")}\n`);
  assert.equal(lines.length, 0, `${lines.length} hard-coded English literals in ${scope}; move each into the catalogue. The full list is in ${FULL_LIST.replace(".txt", `-${scope}.txt`)}`);
}

test("no panel runtime file holds a hard-coded English literal", () => {
  assertNone("panel", report(panelFiles()));
});

test("no user-facing sidecar module holds a hard-coded English literal", () => {
  assertNone("sidecar", report(sidecarFiles()));
});

test("index.html carries every visible word and label through a catalogue key", () => {
  assertNone("markup", markupProblems(readFileSync("apps/panel/index.html", "utf8")));
});

test("every data-i18n attribute names a key that exists", () => {
  assert.deepEqual(unknownKeys(readFileSync("apps/panel/index.html", "utf8")), []);
});

test("the rule recognises English and leaves class lists, selectors and codes alone", () => {
  const sample = ['const a = "Apply changes";', 'const b = `${n} layers`;', 'const c = "plan-card active";', 'const d = "Undo";', 'const e = "元に戻す";', 'const f = "#chat-output > .row";', 'const g = "risky";'];
  const found = sample.map((line) => offencesIn("sample.ts", line, { ...vocabulary, classNames: new Set(["active"]) }).length);
  assert.deepEqual(found, [1, 1, 0, 1, 1, 0, 0]);
});
