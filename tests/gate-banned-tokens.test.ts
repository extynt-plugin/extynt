// scripts/lib/banned-tokens.ts: no in-source suppressions anywhere, plus the native host-boundary bans.
import assert from "node:assert/strict";
import test from "node:test";
import { bannedTokenFailures, stripCppLiterals } from "../scripts/lib/banned-tokens.ts";

const join = (...parts: readonly string[]) => parts.join("");
const AE = "native/extynt-core/ae/panel.mm";
const CORE = "native/extynt-core/core/walker.cpp";

const failures = (key: string, text: string) => bannedTokenFailures([{ key, text }]);

test("suppression comments are rejected in every language", () => {
  assert.equal(failures("a.cpp", `int x; // ${join("NO", "LINT")}(readability)\n`).length, 1);
  assert.equal(failures("a.ts", `// ${join("eslint", "-disable-next-line")} foo\nconst x = 1;\n`).length, 1);
  assert.equal(failures("a.ts", `// ${join("@ts", "-ignore")}\n`).length, 1);
  assert.equal(failures("a.ts", `// ${join("@ts", "-expect-error")}\n`).length, 1);
  assert.equal(failures("a.sh", `# ${join("shellcheck", " disable=SC2086")}\n`).length, 1);
});

test("a shellcheck source directive is not a suppression", () => {
  assert.deepEqual(failures("a.sh", "# shellcheck source=/dev/null\nsource ./x\n"), []);
});

test("main-thread blockers are banned in ae/ only", () => {
  const code = "void f() { [NSApp runModal]; usleep(10); std::this_thread::sleep_for(x); dispatch_sync(q, b); }\n";
  assert.equal(failures(AE, code).length, 4);
  assert.deepEqual(failures("native/extynt-core/transport/server.cpp", "void f() { usleep(10); }\n"), []);
  assert.equal(failures(AE, "void f() { NSAlert* alert; [w beginSheetModalForWindow:a]; nextEventMatchingMask(m); }\n").length, 3);
});

test("comments and string literals do not trip the token bans", () => {
  const code = '// never runModal here\nconst char* s = "NSAlert and sleep(1)";\n/* usleep */\nvoid f() {}\n';
  assert.deepEqual(failures(AE, code), []);
});

test("raw owning new, delete and malloc/free are banned in native code", () => {
  assert.equal(failures(CORE, "void f() { auto* p = new Foo(); delete p; }\n").length, 2);
  assert.equal(failures(CORE, "void f(char* p) { free(p); p = static_cast<char*>(malloc(4)); }\n").length, 2);
  assert.deepEqual(failures(CORE, "struct S { S(const S&) = delete; };\nvoid f() { auto p = std::make_unique<int>(1); }\n"), []);
});

test("stripCppLiterals blanks comments and strings but keeps line structure", () => {
  const text = 'int a; // c\nconst char* s = "x\\"y";\n/* m\nn */ int b;\nauto r = R"x(raw "q")x";\n';
  const stripped = stripCppLiterals(text);
  assert.equal(stripped.split("\n").length, text.split("\n").length);
  assert.ok(!stripped.includes("raw"));
  assert.ok(stripped.includes("int b;"));
});

test("the panel runtime may not touch CEP, page storage or modal dialogs", () => {
  const panel = "apps/panel/runtime/panel-x.ts";
  assert.equal(failures(panel, `const a = window.${join("__adobe", "_cep__")};\n`).length, 1);
  assert.equal(failures(panel, `cep.${join("f", "s")}.readFile(p);\n`).length, 1);
  assert.equal(failures(panel, `host.${join("eval", "Script")}("x");\n`).length, 1);
  assert.equal(failures(panel, `${join("local", "Storage")}.getItem("k");\n`).length, 1);
  assert.equal(failures(panel, `${join("session", "Storage")}.setItem("k", "v");\n`).length, 1);
  assert.equal(failures(panel, `${join("indexed", "DB")}.open("x");\n`).length, 1);
  assert.equal(failures(panel, `${join("ale", "rt")}("x"); ${join("con", "firm")}("y"); ${join("pro", "mpt")}("z");\n`).length, 3);
  assert.equal(failures(panel, `// a comment about ${join("local", "Storage")}\n`).length, 1, "comments are scanned too");
  assert.deepEqual(failures(panel, "const note = setAlert(1); const pro = promptly();\n"), []);
  assert.deepEqual(failures("apps/panel/tests/contract.test.ts", `${join("local", "Storage")}\n`), [], "only the runtime is scoped");
});

test("the capitalised product name is banned in product sources, tests and installers are not scoped", () => {
  const name = join("Ext", "ynt");
  for (const key of ["apps/panel/runtime/panel-x.ts", "apps/sidecar/src/server.ts", "packages/mcp-server/src/plan.ts", "apps/panel/host/bridge.jsx", AE, CORE, "native/extynt-core/core/panel_page.h"]) {
    assert.equal(failures(key, `// ${name} paused\nconst a = "${name}";\n`).length, 2, key);
  }
  assert.deepEqual(failures("apps/panel/runtime/panel-x.ts", "const a = 'extynt'; const b = 'EXTYNT_ROOT_HOST_DIR'; const c = extyntPanel;\n"), []);
  for (const key of ["scripts/install-host-library.ts", "apps/sidecar/tests/x.test.ts", "tools/chat-tests/tests/x.test.ts"]) assert.deepEqual(failures(key, `x = "${name}"\n`), [], key);
});

test("the unknown alias is rejected in TypeScript code but not in comments or strings", () => {
  const name = join("Untr", "usted");
  assert.equal(failures("a.ts", `export type ${name} = unknown;\n`).length, 1);
  assert.deepEqual(failures("a.ts", `// ${name} text\nconst x = "${name}";\n`), []);
});
