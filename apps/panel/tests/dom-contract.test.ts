/**
 * The DOM contract between the runtime (apps/panel/runtime) and the panel's static layer (index.html and styles/):
 * every id the runtime looks up exists in the markup, every class the runtime emits has a rule in the stylesheets,
 * and every stylesheet the markup links exists and ships in the release bundle. The runtime is ported separately,
 * so this test is what keeps the two halves in step.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { panelStyleFiles, readPanelStyles } from "./panel-styles.js";

const RUNTIME_ROOT = "apps/panel/runtime";

const RETIRED_IDS: ReadonlySet<string> = new Set(["chat-save"]);

const CARD_KINDS: ReadonlySet<string> = new Set(["plan"]);

function runtimeSources(): string[] {
  return readdirSync(RUNTIME_ROOT)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => readFileSync(join(RUNTIME_ROOT, file), "utf8"));
}

function allMatches(sources: string[], pattern: RegExp): string[] {
  return sources.flatMap((source) => [...source.matchAll(pattern)].map((match) => match[1] ?? ""));
}

function queriedIds(sources: string[]): Set<string> {
  const ids = allMatches(sources, /(?:byId|getElementById|setText)\(\s*"([^"]+)"/g);
  return new Set([...ids, ...allMatches(sources, /querySelector\(\s*"#([\w-]+)"/g)]);
}

function classTokens(text: string): string[] {
  return text.split(/\s+/).filter((token) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(token) && !token.endsWith("-"));
}

function assignedClasses(sources: string[]): string[] {
  const statements = allMatches(sources, /className\s*\+?=\s*([^;\n]+)/g);
  return statements.flatMap((statement) => allMatches([statement.replace(/getAttribute\("[^"]*"\)/g, "")], /"([^"]*)"/g));
}

function emittedClasses(sources: string[]): Set<string> {
  const groups = [
    allMatches(sources, /\bel\(\s*"[a-z0-9]+"\s*,\s*"([^"]*)"/g),
    assignedClasses(sources),
    allMatches(sources, /classList\.(?:add|toggle)\(\s*"([^"]+)"/g),
    allMatches(sources, /setAttribute\(\s*"class"\s*,\s*"([^"]*)"/g),
    allMatches(sources, /addMessage\(\s*"(\w+)"/g).filter((kind) => !CARD_KINDS.has(kind)),
  ];
  return new Set(groups.flat().flatMap(classTokens));
}

function markupIds(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? ""));
}

test("every id the runtime looks up exists in index.html", () => {
  const present = markupIds(readFileSync("apps/panel/index.html", "utf8"));
  const queried = [...queriedIds(runtimeSources())].filter((id) => !RETIRED_IDS.has(id));
  assert.ok(queried.length > 40, `the scan found the runtime's lookups (${queried.length})`);
  assert.deepEqual(
    queried.filter((id) => !present.has(id)),
    [],
    "ids the runtime queries but the markup lacks",
  );
});

test("every class the runtime emits has a rule in styles/", () => {
  const css = readPanelStyles();
  const emitted = [...emittedClasses(runtimeSources())];
  assert.ok(emitted.length > 100, `the scan found the runtime's classes (${emitted.length})`);
  const unstyled = emitted.filter((name) => !new RegExp(`\\.${name}(?![\\w-])`).test(css));
  assert.deepEqual(unstyled, [], "classes the runtime emits that no stylesheet mentions");
});

test("the markup links only stylesheets that exist, and carries no inline style or handler", () => {
  const html = readFileSync("apps/panel/index.html", "utf8");
  const linked = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1] ?? "");
  assert.ok(linked.length >= 3, "the markup links its stylesheets");
  for (const href of linked) assert.ok(existsSync(join("apps/panel", href)), `${href} is linked but missing`);
  const files = panelStyleFiles().map((file) => file.replace("apps/panel/", ""));
  assert.deepEqual(
    files.filter((file) => !linked.includes(file)),
    [],
    "stylesheets that exist but are never linked",
  );
  assert.doesNotMatch(html, /<style[\s>]/, "no inline stylesheet");
  assert.doesNotMatch(html, /\sstyle=|\son[a-z]+=/, "no inline style attribute or event handler");
});

test("the release bundle serves exactly the files ui-manifest.json lists, stylesheets included", () => {
  const build = readFileSync("scripts/build-mac-bundle.sh", "utf8");
  assert.ok(
    build.includes('"${repo_root}/apps/panel/${path}"') && build.includes("ui-manifest.json"),
    "the bundle's ui/ is copied from the manifest",
  );
  const listed = [...readFileSync("apps/panel/ui-manifest.json", "utf8").matchAll(/"path": "([^"]+)"/g)].map((match) => match[1] ?? "");
  const linked = [...readFileSync("apps/panel/index.html", "utf8").matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );
  assert.deepEqual(
    linked.filter((href) => !listed.includes(href)),
    [],
    "stylesheets the markup links but the manifest omits",
  );
});

const PLAN_PARTS = [
  "plan-ops",
  "plan-op-label",
  "plan-op-target",
  "plan-op-values",
  "plan-op-before",
  "plan-op-after",
  "receipt-line",
  "receipt-checklist",
  "check-list",
  "check-row",
  "check-mark",
  "check-text",
  "check-note",
  "thumb-slot",
  "thumb-pair",
  "card-menu",
  "card-menu-btn",
  "card-menu-pop",
  "ctx-chip-label",
  "ctx-chip-text",
  "effort-label",
  "answer-details",
];
const SURFACE_PARTS = [
  "status-bar",
  "bar-row",
  "bar-main",
  "bar-copy",
  "bar-text",
  "bar-sub",
  "bar-eta",
  "bar-count",
  "bar-chip",
  "bar-actions",
  "bar-step",
  "bar-progress",
  "bar-segment",
  "sheet",
  "sheet-section",
  "sheet-title",
  "sheet-item",
  "now-row",
  "source-tag",
  "look-row",
  "check-phase",
  "change-row",
  "change-head",
  "change-fold",
  "plan-fold",
  "filter-chips",
  "link-row",
  "page",
  "page-head",
  "page-body",
  "acc-head",
  "acc-body",
];

test("the plan detail's, the bar's, the sheet's and the page's structural classes have a rule", () => {
  const css = readPanelStyles();
  assert.deepEqual(
    [...PLAN_PARTS, ...SURFACE_PARTS].filter((name) => !new RegExp(`\\.${name}(?![\\w-])`).test(css)),
    [],
    "classes with no rule",
  );
  for (const tone of ["accent", "amber", "red", "grey", "dashed"]) assert.ok(css.includes(`[data-tone="${tone}"]`), tone);
});

test("one scroller per surface: no overflow: scroll, no horizontal scrolling, and only the thread, sheet, page body and popover scroll", () => {
  const css = readPanelStyles();
  assert.doesNotMatch(css, /overflow(-[xy])?:\s*scroll/);
  assert.doesNotMatch(css, /overflow-x:\s*auto/);
  const scrollers: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    if (/overflow(-y)?:\s*auto/.test(match[2] ?? "")) scrollers.push((match[1] ?? "").trim());
  assert.deepEqual(scrollers.sort(), ["#chat-output", ".menu-body", ".page-body", ".sheet"]);
});

test("component stylesheets use tokens for every colour, never a literal", () => {
  const files = panelStyleFiles().filter((file) => !file.endsWith("tokens.css"));
  const literal = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
  const offenders = files.filter((file) =>
    literal.test(
      readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/url\("data:[^"]*"\)/g, ""),
    ),
  );
  assert.deepEqual(offenders, [], "stylesheets with a literal colour");
});
