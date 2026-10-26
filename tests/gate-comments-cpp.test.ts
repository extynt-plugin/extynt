// scripts/lib/comments/cpp-comments.ts: the header and declaration-doc policy for C++ and Objective-C++ files.
import assert from "node:assert/strict";
import test from "node:test";
import { cppCommentFailures } from "../scripts/lib/comments/cpp-comments.ts";

const failures = (key: string, text: string) => cppCommentFailures(key, text);
const lines = (found: readonly string[]) => found.map((failure: string) => Number(failure.split(":")[1]));

test("a header comment alone is enough for a source file", () => {
  assert.deepEqual(failures("a.cpp", "// Implements it.\nint f() { return 1; }\n"), []);
});

test("every file needs a header comment", () => {
  assert.deepEqual(lines(failures("a.cpp", "int f() { return 1; }\n")), [1]);
  assert.deepEqual(lines(failures("a.h", "#pragma once\n")), [1]);
});

test("a source file keeps nothing but its header", () => {
  assert.deepEqual(lines(failures("a.cpp", "// h\n// not a doc\nint f() { return 1; }\n")), []);
  assert.deepEqual(lines(failures("a.cpp", "// h\n\n/** doc */\nint f() { return 1; }\n")), [3]);
});

test("doc comments above header declarations pass at namespace and class scope", () => {
  const text = "// Declares it.\n#pragma once\nnamespace ns {\n/** The class. */\nclass A {\n public:\n  /** Reads. */\n  int read() const;\n};\n}\n";
  assert.deepEqual(failures("a.h", text), []);
});

test("a comment inside an inline function body fails", () => {
  const text = "// Declares it.\nclass A {\n  int read() const {\n    // why\n    return 1;\n  }\n};\n";
  assert.deepEqual(lines(failures("a.h", text)), [4]);
});

test("a trailing comment and a comment above an include fail", () => {
  assert.deepEqual(lines(failures("a.h", "// h\n#include <vector> // for it\n")), [2]);
  assert.deepEqual(lines(failures("a.h", "// h\n/** doc */\n#include <vector>\n")), [2]);
});

test("comment-like text in strings, raw strings and digit separators is not a comment", () => {
  const text = "// h\nconst char* a = \"// no\";\nconst char* b = R\"x(/* no */ // no)x\";\nint c = 1'000;\nchar d = '/';\n";
  assert.deepEqual(failures("a.cpp", text), []);
});

test("a backslash-continued macro with CRLF line endings is one directive, like with LF", () => {
  const lf = "// Header.\n#define TWICE(x) \\\n  ((x) * 2)\n/* not a doc comment */\nint main();\n";
  assert.deepEqual(cppCommentFailures("a.h", lf.replaceAll("\n", "\r\n")), cppCommentFailures("a.h", lf));
});

test("an Objective-C interface or protocol is a class scope until its @end", () => {
  const scoped = "// h\n/** The view. */\n@interface A : NSView\n/** Shows. */\n- (void)show;\n@end\n/** The protocol. */\n@protocol P\n/** Asks. */\n- (int)ask;\n@end\n";
  assert.deepEqual(failures("a.h", scoped), []);
  assert.deepEqual(lines(failures("a.h", "// h\n@protocol P;\n/** Doc. */\nint z;\n@interface A\n- (void)f {\n  // no\n}\n@end\n")), [7]);
  assert.deepEqual(lines(failures("a.h", "// h\n@interface A\n@end\nint f() {\n  // no\n}\n")), [5]);
});
