// scripts/lib/typecheck.ts, type-escapes.ts, census.ts and areas.ts: per-area error counts and the escape-hatch census.
import assert from "node:assert/strict";
import test from "node:test";
import { areaOf, nativeAreaOf } from "../scripts/lib/areas.ts";
import { formatCensus, nativeCensus, typeCensus } from "../scripts/lib/census.ts";
import { errorsByArea, errorsByCode, typecheckHeadline } from "../scripts/lib/typecheck.ts";
import { errorsByProject, extendsStrict, optInLine, projectOf, projectStatus, ratchetViolations } from "../scripts/lib/strict-projects.ts";
import { escapeCounts } from "../scripts/lib/type-escapes.ts";

interface ProjectOptIn {
  readonly dir: string;
  readonly optedIn: boolean;
}

const TSC = [
  "apps/sidecar/src/a.ts(1,2): error TS4111: Property 'x' comes from an index signature.",
  "apps/sidecar/src/b.ts(3,4): error TS4111: Property 'y' comes from an index signature.",
  "packages/llm/src/c.ts(5,6): error TS2375: Type is not assignable.",
  "  continuation line",
].join("\n");

test("areas follow the repository layout", () => {
  assert.equal(areaOf("apps/sidecar/src/a.ts"), "apps/sidecar");
  assert.equal(areaOf("apps/panel/runtime/a.ts"), "apps/panel/runtime");
  assert.equal(areaOf("apps/panel/tests/a.ts"), "apps/panel/tests");
  assert.equal(areaOf("packages/llm/src/a.ts"), "packages/llm");
  assert.equal(areaOf("tools/fake-plugin/src/a.ts"), "tools/fake-plugin");
  assert.equal(areaOf("scripts/a.ts"), "scripts");
  assert.equal(areaOf("tests/a.ts"), "tests");
  assert.equal(areaOf("plugin/a.ts"), "other");
  assert.equal(nativeAreaOf("native/extynt-core/catalogue-window/a.cpp"), "catalogue-window");
  assert.equal(nativeAreaOf("packaging/a.h"), "other");
});

test("typecheck errors are counted per area and per code", () => {
  assert.deepEqual(errorsByArea(TSC), [{ area: "apps/sidecar", count: 2 }, { area: "packages/llm", count: 1 }]);
  assert.deepEqual(errorsByCode(TSC), [{ code: "TS4111", count: 2 }, { code: "TS2375", count: 1 }]);
  assert.equal(typecheckHeadline(TSC)[0], "3 type error(s) in 2 area(s); codes: TS4111=2 TS2375=1");
});

test("escape hatches are counted and as const is not one", () => {
  const text = "export const a: any = 1;\nexport const b = x as Foo;\nexport const c = <Foo>x;\nexport const d = y!;\nexport const e = [1] as const;\n";
  assert.deepEqual(escapeCounts("a.ts", text), { any: 1, casts: 2, nonNull: 1, restricted: 0 });
});

test("restricted stand-in types are counted", () => {
  const text = "type A = object;\ntype B = Function;\ntype C = {};\ntype D = Record<string, unknown>;\ntype E = Record<string, any>;\ntype F = Record<string, number>;\n";
  assert.equal(escapeCounts("a.ts", text).restricted, 5);
});

test("the type census adds unknown violations and keeps empty areas", () => {
  const table = typeCensus([{ key: "apps/sidecar/src/a.ts", text: "export type A = unknown;\nexport const b = x as Foo;\n" }]);
  assert.deepEqual(table.get("apps/sidecar"), { any: 0, casts: 1, nonNull: 0, restricted: 0, unknown: 1 });
  assert.deepEqual(table.get("scripts"), { any: 0, casts: 0, nonNull: 0, restricted: 0, unknown: 0 });
});

test("the native census counts erased types and casts per directory and ignores comments", () => {
  const table = nativeCensus([
    { key: "native/extynt-core/ae/a.cpp", text: "void* p; auto* q = reinterpret_cast<char*>(p); // const_cast\n" },
    { key: "native/extynt-core/core/b.h", text: "std::any a;\nunion U { int a; };\n" },
  ]);
  assert.deepEqual(table.get("ae"), { "void*": 1, "std::any": 0, reinterpret_cast: 1, const_cast: 0, union: 0 });
  assert.deepEqual(table.get("core"), { "void*": 0, "std::any": 1, reinterpret_cast: 0, const_cast: 0, union: 1 });
  assert.deepEqual(table.get("transport"), { "void*": 0, "std::any": 0, reinterpret_cast: 0, const_cast: 0, union: 0 });
});

test("the census table ends with a total row", () => {
  const table = new Map([["a", { x: 1 }], ["b", { x: 2 }]]);
  assert.deepEqual(formatCensus(table, ["x"]).split("\n"), ["area   x", "a      1", "b      2", "TOTAL  3"]);
});

const DIRS = ["apps/sidecar", "packages/llm", "packages/decode"];

test("opting in means extending tsconfig.strict.json, alone or in a list", () => {
  assert.equal(extendsStrict({ extends: "../../tsconfig.strict.json" }), true);
  assert.equal(extendsStrict({ extends: ["./a.json", "../../tsconfig.strict.json"] }), true);
  assert.equal(extendsStrict({ extends: "../../tsconfig.base.json" }), false);
  assert.equal(extendsStrict({}), false);
});

test("errors are attributed to the project that owns the file", () => {
  assert.equal(projectOf("packages/llm/src/c.ts", DIRS), "packages/llm");
  assert.equal(projectOf("scripts/a.ts", DIRS), null);
  assert.deepEqual([...errorsByProject(TSC, DIRS)], [["apps/sidecar", 2], ["packages/llm", 1], ["packages/decode", 0]]);
});

test("the ratchet fails a clean project that has not opted in", () => {
  const status = [{ dir: "apps/sidecar", optedIn: false }, { dir: "packages/llm", optedIn: false }, { dir: "packages/decode", optedIn: true }];
  const counts = new Map([["apps/sidecar", 2], ["packages/llm", 0], ["packages/decode", 0]]);
  assert.deepEqual(ratchetViolations(status, counts), ["packages/llm: typechecks clean under the strict flags; extend tsconfig.strict.json in its tsconfig.json"]);
  assert.deepEqual(ratchetViolations(status, new Map([["apps/sidecar", 1], ["packages/llm", 1], ["packages/decode", 0]])), []);
});

test("the opt-in line lists both groups", () => {
  const status = [{ dir: "a", optedIn: true }, { dir: "b", optedIn: false }, { dir: "c", optedIn: false }];
  assert.equal(optInLine(status), "strict opt-in: a; not yet: b, c");
  assert.equal(optInLine([{ dir: "a", optedIn: true }]), "strict opt-in: a; not yet: none");
});

test("the repository's projects read their opt-in from their tsconfig", () => {
  const status = projectStatus();
  assert.equal(status.find((project: ProjectOptIn) => project.dir === "packages/decode")?.optedIn, true);
});
