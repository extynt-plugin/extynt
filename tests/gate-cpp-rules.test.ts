// scripts/lib/cpp-rules.ts: include architecture across core/, transport/, ae/, catalogue-window/, tests/ and the AE callback boundary.
import assert from "node:assert/strict";
import test from "node:test";
import { callbackFailures, includeFailures, includesOf } from "../scripts/lib/cpp-rules.ts";

const N = "native/extynt-core/";
const SOURCES = [
  { key: `${N}core/walker.h`, text: "" },
  { key: `${N}transport/server.h`, text: "" },
  { key: `${N}ae/ae_reader.h`, text: "" },
  { key: `${N}catalogue-window/catalogue_status.h`, text: "" },
  { key: `${N}tests/testing.h`, text: "" },
];

function failuresFor(key: string, text: string) {
  return includeFailures([...SOURCES, { key, text }]).filter((failure: string) => failure.startsWith(key));
}

test("includesOf lists include directives with their kind and line", () => {
  assert.deepEqual(includesOf('#include "a.h"\n  #  include <vector>\nint x;\n'), [
    { line: 1, kind: '"', path: "a.h" },
    { line: 2, kind: "<", path: "vector" },
  ]);
});

test("core/ may include core, xxhash and the C++ standard library only", () => {
  assert.deepEqual(failuresFor(`${N}core/a.cpp`, '#include "walker.h"\n#include "xxhash.h"\n#include <vector>\n#include <cstdint>\n'), []);
  assert.equal(failuresFor(`${N}core/a.cpp`, "#include <unistd.h>\n").length, 1);
  assert.equal(failuresFor(`${N}core/a.cpp`, "#include <sys/socket.h>\n").length, 1);
  assert.equal(failuresFor(`${N}core/a.cpp`, '#include "server.h"\n').length, 1);
  assert.equal(failuresFor(`${N}core/a.cpp`, '#include "ae_reader.h"\n').length, 1);
});

test("transport/ may include core and POSIX headers but never ae/", () => {
  assert.deepEqual(failuresFor(`${N}transport/a.cpp`, '#include "server.h"\n#include "walker.h"\n#include <unistd.h>\n'), []);
  assert.equal(failuresFor(`${N}transport/a.cpp`, '#include "ae_reader.h"\n').length, 1);
  assert.equal(failuresFor(`${N}transport/a.cpp`, '#include "xxhash.h"\n').length, 1);
});

test("catalogue-window/ may include core, transport, its own headers and OS headers but never ae/", () => {
  assert.deepEqual(failuresFor(`${N}catalogue-window/a.cpp`, '#include "catalogue_status.h"\n#include "walker.h"\n#include "server.h"\n#include <windows.h>\n'), []);
  assert.equal(failuresFor(`${N}catalogue-window/a.cpp`, '#include "ae_reader.h"\n').length, 1);
  assert.equal(failuresFor(`${N}catalogue-window/a.cpp`, '#include "unknown.h"\n').length, 1);
});

test("tests/ may include the catalogue window's headers", () => {
  assert.deepEqual(failuresFor(`${N}tests/a.cpp`, '#include "catalogue_status.h"\n'), []);
});

test("tests/ may include core, transport and their own helpers, never ae/ or SDK headers", () => {
  assert.deepEqual(failuresFor(`${N}tests/a.cpp`, '#include "testing.h"\n#include "walker.h"\n#include "server.h"\n#include <unistd.h>\n'), []);
  assert.equal(failuresFor(`${N}tests/a.cpp`, '#include "ae_reader.h"\n').length, 1);
  assert.equal(failuresFor(`${N}tests/a.cpp`, '#include "AE_GeneralPlug.h"\n').length, 1);
  assert.equal(failuresFor(`${N}tests/a.cpp`, "#include <AE_Macros.h>\n").length, 1);
});

test("an include listed twice in one file fails, in Windows and portable files alike", () => {
  assert.equal(failuresFor(`${N}ae/a_win.cpp`, "#include <windows.h>\n#include <string>\n#include <windows.h>\n").length, 1);
  assert.equal(failuresFor(`${N}core/a.cpp`, '#include "walker.h"\n#include <vector>\n#include "walker.h"\n').length, 1);
  assert.deepEqual(failuresFor(`${N}core/a.cpp`, '#include <vector>\n#include "walker.h"\n'), []);
});

test("ae/ may include anything, including SDK headers", () => {
  assert.deepEqual(failuresFor(`${N}ae/a.cpp`, '#include "walker.h"\n#include "server.h"\n#include "AE_GeneralPlug.h"\n#include <Cocoa/Cocoa.h>\n'), []);
});

const HOOKS = `
A_Err IdleHook(AEGP_GlobalRefcon, AEGP_IdleRefcon, A_long*) noexcept {
  try { run(); } catch (...) { return 0; }
  return 0;
}
A_Err DeathHook(AEGP_GlobalRefcon, AEGP_DeathRefcon) noexcept { try { stop(); } catch (...) {} return 0; }
bool registerHooks(Plugin& p) {
  p.suites.registrar->AEGP_RegisterIdleHook(p.id, IdleHook, nullptr);
  p.suites.registrar->AEGP_RegisterDeathHook(p.id, DeathHook, nullptr);
  return true;
}
A_Err initializePlugin(const PluginEntry& e) noexcept { try { return start(e); } catch (...) { return 1; } }
`;

const callbacks = (text: string) => callbackFailures([{ key: `${N}ae/ae_entry.cpp`, text }]);
const firstFailure = (found: readonly string[]) => found[0] ?? "";

test("registered callbacks that are noexcept and catch everything pass", () => {
  assert.deepEqual(callbacks(HOOKS), []);
});

test("a registered callback without noexcept or without catch (...) fails", () => {
  const noNoexcept = HOOKS.replace("A_long*) noexcept {", "A_long*) {");
  assert.equal(callbacks(noNoexcept).length, 1);
  const noCatch = HOOKS.replace("try { stop(); } catch (...) {}", "stop();");
  assert.match(firstFailure(callbacks(noCatch)), /DeathHook must catch/);
  const noEntry = HOOKS.replace("initializePlugin(const PluginEntry& e) noexcept", "initializePlugin(const PluginEntry& e)");
  assert.match(firstFailure(callbacks(noEntry)), /initializePlugin/);
});

test("the callback is found at its own position in command and panel registrations", () => {
  const text = `${HOOKS}
A_Err commandHook(A, B, C, D, E, F) { return 0; }
void more(P& p) { p.r->AEGP_RegisterCommandHook(p.id, AEGP_HP_BeforeAE, p.command, commandHook, nullptr); }
`;
  assert.match(firstFailure(callbacks(text)), /commandHook is registered/);
});

test("a HookAdapter instantiation is accepted and any other callback expression fails", () => {
  const adapter = `${HOOKS}
void more(P& p) { p.r->AEGP_RegisterCommandHook(p.id, AEGP_HP_BeforeAE, p.command, extynt::ae::HookAdapter<AEGP_CommandHook>::run<Call, handle>, nullptr); }
`;
  assert.deepEqual(callbacks(adapter), []);
  for (const argument of ["[](auto) { return 0; }", "choose()", "table[0]", "Other<AEGP_CommandHook>::run<Call, handle>"]) {
    const text = `${HOOKS}\nvoid more(P& p) { p.r->AEGP_RegisterUpdateMenuHook(p.id, ${argument}, nullptr); }\n`;
    assert.match(firstFailure(callbacks(text)), /UpdateMenuHook is given/, argument);
  }
});

test("an arrow, shift or comparison operator in an earlier argument does not hide the callback", () => {
  for (const earlier of ["p->id", "p->a->b", "a << 1", "a >> 1", "a <= b", "a >= b"]) {
    const text = `${HOOKS}\nA_Err bad(A) { return 0; }\nvoid more(P& p) { p.r->AEGP_RegisterUpdateMenuHook(${earlier}, bad, nullptr); }\n`;
    assert.match(firstFailure(callbacks(text)), /bad is registered/, earlier);
  }
  const nested = `${HOOKS}\nvoid more(P& p) { p.r->AEGP_RegisterCommandHook(p.id, Map<K, Vec<V>>::kind, p.command, extynt::ae::HookAdapter<AEGP_CommandHook>::run<Call, handle>, nullptr); }\n`;
  assert.deepEqual(callbacks(nested), []);
});

test("EntryPointFunc must be one return that forwards to initializePlugin", () => {
  const entry = (body: string) => callbackFailures([{ key: `${N}ae/sdk_entry.cpp`, text: `extern "C" A_Err EntryPointFunc(S* b) noexcept ${body}\nA_Err initializePlugin(const E& e) noexcept { try { return 0; } catch (...) { return 1; } }\n` }]);
  assert.deepEqual(entry("{\n  return extynt::ae::initializePlugin({b});\n}"), []);
  assert.match(firstFailure(entry("{ prepare(); return initializePlugin({b}); }")), /exactly one return/);
  assert.match(firstFailure(entry("{ return other(b); }")), /exactly one return/);
  assert.deepEqual(entry("{ return initializePlugin({b, c, d}); }"), []);
  assert.deepEqual(entry("{ return initializePlugin(b, c); }"), []);
  assert.match(firstFailure(entry("{ return initializePlugin(prepare()); }")), /exactly one return/);
  assert.match(firstFailure(entry("{ return initializePlugin(x) + other(); }")), /exactly one return/);
  assert.match(firstFailure(entry("{ return initializePlugin({b, prepare(c)}); }")), /exactly one return/);
});
