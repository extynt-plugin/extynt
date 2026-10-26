// scripts/lib/banned-tokens.ts: void*, std::any and the casts are banned in native code; only ae/sdk_* files may cast.
import assert from "node:assert/strict";
import test from "node:test";
import { bannedTokenFailures } from "../scripts/lib/banned-tokens.ts";

const failures = (key: string, text: string) => bannedTokenFailures([{ key, text }]);
const CORE = "native/extynt-core/core/walker.cpp";
const WRAPPER = "native/extynt-core/ae/sdk_handle.cpp";
const PRODUCT = "native/extynt-core/ae/ae_reader.cpp";

test("void pointers are banned in every owned C++ file, spaced or not", () => {
  assert.equal(failures(CORE, "void f(void* p);\n").length, 1);
  assert.equal(failures(CORE, "void f(const void *p, void **q);\n").length, 2);
  assert.equal(failures(WRAPPER, "using Raw = void*;\n").length, 1);
  assert.equal(failures("packaging/macos/release/catalogue-window/CatalogueView.h", "void* owner;\n").length, 1);
});

test("a void function and a void function pointer are not void pointers", () => {
  assert.deepEqual(failures(CORE, "void f();\nusing Callback = void (*)(int);\n"), []);
});

test("std::any and the any header are banned", () => {
  assert.equal(failures(CORE, "std::any payload;\n").length, 1);
  assert.equal(failures(CORE, "#include <any>\n").length, 1);
  assert.deepEqual(failures(CORE, "std::variant<int, bool> payload;\nstd::company name;\n"), []);
});

test("reinterpret_cast and const_cast are banned outside ae/sdk_ files", () => {
  assert.equal(failures(CORE, "auto* p = reinterpret_cast<char*>(q);\n").length, 1);
  assert.equal(failures(PRODUCT, "auto& r = const_cast<Foo&>(f);\n").length, 1);
  assert.equal(failures("native/extynt-core/transport/server.cpp", "auto* p = reinterpret_cast<sockaddr*>(a);\n").length, 1);
  assert.equal(failures("native/extynt-core/tests/walker_test.cpp", "auto& r = const_cast<Foo&>(f);\n").length, 1);
});

test("files named ae/sdk_ with a C++ extension may cast", () => {
  const code = "auto* p = reinterpret_cast<Raw*>(q);\nauto& r = const_cast<Foo&>(f);\n";
  for (const name of ["sdk_handle.cpp", "sdk_handle.h", "sdk_window.mm"]) assert.deepEqual(failures(`native/extynt-core/ae/${name}`, code), []);
});

test("the sdk wrapper convention is the ae directory and the sdk_ prefix, nothing looser", () => {
  const code = "auto* p = reinterpret_cast<Raw*>(q);\n";
  assert.equal(failures("native/extynt-core/core/sdk_handle.cpp", code).length, 1);
  assert.equal(failures("native/extynt-core/ae/my_sdk_handle.cpp", code).length, 1);
  for (const dir of ["transport", "catalogue-window"]) assert.deepEqual(failures(`native/extynt-core/${dir}/sdk_handle.cpp`, code), []);
  assert.equal(failures("native/extynt-core/ae/sdk/handle.cpp", code).length, 1);
});

test("wrapper files may not erase types even though they may cast", () => {
  assert.equal(failures(WRAPPER, "std::any a; void* p;\n").length, 2);
});

test("comments and string literals do not trip the type bans", () => {
  const code = '// reinterpret_cast and void* and std::any\nconst char* s = "const_cast<void*>";\nvoid f() {}\n';
  assert.deepEqual(failures(CORE, code), []);
});

test("static_cast and dynamic_cast stay allowed", () => {
  assert.deepEqual(failures(CORE, "auto n = static_cast<int>(x);\nauto* d = dynamic_cast<Derived*>(b);\n"), []);
});

test("wrapper files may write void* only as an out-parameter local or a named parameter", () => {
  assert.deepEqual(failures(WRAPPER, "void run() {\n  const void* suite = nullptr;\n  void* raw = nullptr;\n  acquire(&suite, &raw);\n}\n"), []);
  assert.deepEqual(failures(WRAPPER, "int lock(void* handle, const void* data, int size);\n"), []);
  assert.deepEqual(failures(WRAPPER, "int lock(int size, void** out);\n"), []);
});

test("wrapper files may not declare a void* member, case-label local, unused local or sizeof operand", () => {
  const rejected = [
    "struct S {\n  void* m = nullptr;\n};\n",
    "class C {\n public:\n  void* m = nullptr;\n};\n",
    "namespace n {\nvoid* global = nullptr;\n}\n",
    "void run(int k) {\n  switch (k) {\n    case 1: void* z = nullptr; use(&z); break;\n  }\n}\n",
    "void run() {\n  void* raw = nullptr;\n  use(raw);\n}\n",
    "constexpr auto n = sizeof(void* z);\n",
    "auto f = [](void* p) { use(p); };\n",
  ];
  for (const code of rejected) assert.equal(failures(WRAPPER, code).length, 1, code);
});

test("a void* out-parameter local inside a member function body is allowed when its address is passed", () => {
  assert.deepEqual(failures(WRAPPER, "struct S {\n  void f() {\n    void* raw = nullptr;\n    lock(&raw);\n  }\n};\n"), []);
  assert.deepEqual(failures(WRAPPER, "int lock(int size, void** out) { return 0; }\n"), []);
});

test("wrapper files may not alias, store, return or cast to void*", () => {
  for (const code of ["using Raw = void*;\n", "struct S {\n  void* member;\n};\n", "void* make(int size);\n", "auto* p = static_cast<void*>(q);\n", "auto p = (void*)q;\n", "auto* p = reinterpret_cast<void*>(q);\n"]) {
    assert.equal(failures(WRAPPER, code).length, 1, code);
  }
});

test("the C printf and scanf families and vararg function pointers are banned outside wrapper files", () => {
  for (const code of ["std::snprintf(b, n, \"%d\", x);\n", "printf(\"x\");\n", "sscanf(s, \"%d\", &x);\n", "using F = int (*)(char*, size_t, const char*, ...);\n"]) {
    assert.equal(failures(CORE, code).length, 1, code);
    assert.equal(failures(PRODUCT, code).length, 1, code);
    assert.deepEqual(failures(WRAPPER, code), [], code);
  }
  for (const code of ["auto fn = &std::snprintf;\n", "auto fn = &sprintf_s;\n", "wsprintfW(buffer, format);\n", "auto fn = wsprintfA;\n", "int n = _snwprintf(b, 4, f);\n", "fscanf_s(f, g);\n"]) {
    assert.equal(failures(CORE, code).length, 1, code);
    assert.deepEqual(failures(WRAPPER, code), [], code);
  }
  assert.deepEqual(failures(CORE, "template <typename... Ps>\nstruct A<R (*)(Ps...)> {};\n"), []);
});

test("va_list, va_start and __VA_ARGS__ are banned outside wrapper files", () => {
  for (const code of ["void f(const char* format, ...) { va_list args; va_start(args, format); va_end(args); }\n", "#define LOG(...) write(__VA_ARGS__)\n"]) {
    assert.ok(failures(CORE, code).length >= 1, code);
    assert.deepEqual(failures(WRAPPER, code), [], code);
  }
});

test("identifiers that merely contain print or scan, and string literals, are not vararg functions", () => {
  assert.deepEqual(failures(CORE, 'const char* s = "printf and va_list";\nint blueprint = 1;\nvoid scanFonts();\nint printfulness = 0;\n'), []);
});
