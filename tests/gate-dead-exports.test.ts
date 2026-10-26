// scripts/lib/dead-exports.ts: an exported symbol nothing imports fails; imports, re-exports and public entries keep it alive.
import assert from "node:assert/strict";
import test from "node:test";
import { findDeadExports } from "../scripts/lib/dead-exports.ts";

const PACKAGES = new Map([
  ["@x/lib", { directory: "/r/packages/lib", entries: new Map([[".", ["./dist/src/index.js"]]]) }],
  ["@x/app", { directory: "/r/apps/app", entries: new Map() }],
]);

function dead(files: Readonly<Record<string, string>>) {
  const texts = new Map(Object.entries(files));
  const isExporter = (file: string) => /\/src\//.test(file);
  return findDeadExports({ texts, packages: PACKAGES, isExporter }).map(({ file, name }) => `${file.replace("/r/", "")}#${name}`).sort();
}

test("an export nothing imports is dead and an imported one is alive", () => {
  const found = dead({
    "/r/apps/app/src/a.ts": "export const used = 1;\nexport const unused = 2;\n",
    "/r/apps/app/src/b.ts": "import { used } from \"./a.js\";\nexport const root = used;\n",
  });
  assert.deepEqual(found, ["apps/app/src/a.ts#unused", "apps/app/src/b.ts#root"]);
});

test("tests and other packages count as importers", () => {
  const found = dead({
    "/r/apps/app/src/a.ts": "export const used = 1;\n",
    "/r/apps/app/tests/a.test.ts": "import { used } from \"../src/a.js\";\nconsole.log(used);\n",
  });
  assert.deepEqual(found, []);
});

test("a package entry makes its re-exports public", () => {
  const found = dead({
    "/r/packages/lib/src/index.ts": "export { api } from \"./api.js\";\nexport * from \"./more.js\";\n",
    "/r/packages/lib/src/api.ts": "export const api = 1;\nexport const hidden = 2;\n",
    "/r/packages/lib/src/more.ts": "export const more = 3;\n",
  });
  assert.deepEqual(found, ["packages/lib/src/api.ts#hidden"]);
});

test("a workspace import resolves through the package entry", () => {
  const found = dead({
    "/r/packages/lib/src/index.ts": "export const api = 1;\n",
    "/r/apps/app/src/a.ts": "import { api } from \"@x/lib\";\nexport const run = api;\n",
  });
  assert.deepEqual(found, ["apps/app/src/a.ts#run"]);
});

test("a namespace import or a dynamic import keeps every export", () => {
  const found = dead({
    "/r/apps/app/src/a.ts": "export const one = 1;\nexport const two = 2;\n",
    "/r/apps/app/src/b.ts": "import * as a from \"./a.js\";\nexport const names = Object.keys(a);\n",
    "/r/apps/app/src/c.ts": "export const later = () => import(\"./b.js\");\n",
  });
  assert.deepEqual(found, ["apps/app/src/c.ts#later"]);
});

test("default exports, export lists, types and destructured constants are tracked", () => {
  const found = dead({
    "/r/apps/app/src/a.ts": "const one = 1;\nconst two = 2;\nexport { one, two as second };\nexport default function main() { return 1; }\nexport interface Shape { a: 1 }\nexport const { left, right } = { left: 1, right: 2 };\n",
    "/r/apps/app/src/b.ts": "import main, { second, type Shape, left } from \"./a.js\";\nexport const use = [main, second, left];\n",
  });
  assert.deepEqual(found, ["apps/app/src/a.ts#one", "apps/app/src/a.ts#right", "apps/app/src/b.ts#use"]);
});
