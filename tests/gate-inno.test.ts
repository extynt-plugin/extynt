// scripts/lib/inno-lexer.ts and inno-rules.ts: the comment policy and size limits for Inno Setup scripts.
import assert from "node:assert/strict";
import test from "node:test";
import { commentFailures } from "../scripts/lib/comment-rules.ts";
import { headerLineCount } from "../scripts/lib/census.ts";
import { scanInno } from "../scripts/lib/inno-lexer.ts";
import { innoCommentFailures, innoMetricFailures } from "../scripts/lib/inno-rules.ts";

const HEAD = "; Installer.\n\n[Setup]\nAppName=x\n\n[Code]\n";
const routine = (name: string, body: string, params = "") => `function ${name}${params}: Boolean;\nbegin\n${body}\nend;\n\n`;
const lines = (found: readonly string[]) => found.map((failure) => Number(failure.split(":")[1]));

test("the scan finds ; comments, Pascal comments and masks strings and comments in [Code]", () => {
  const scan = scanInno(`${HEAD}{ doc }\nfunction F: String;\nbegin\n  Result := 'a { not } // comment'; // trailing\nend;\n`);
  assert.deepEqual(scan.comments.map((comment) => [comment.line, comment.ownLine]), [[1, true], [7, true], [10, false]]);
  assert.equal(scan.masked[9]?.includes("comment"), false);
  assert.equal(scan.masked[9]?.includes("Result :="), true);
});

test("a multi-line brace comment is one block and a doubled quote stays inside its string", () => {
  const scan = scanInno(`${HEAD}{ one\n  two }\nprocedure P;\nbegin\n  Log('it''s { fine');\nend;\n`);
  const block = scan.comments.find((comment) => comment.line === 7);
  assert.equal(block?.endLine, 8);
  assert.equal(scan.masked[10]?.includes("fine"), false);
});

test("a file needs a header comment before its first directive or entry", () => {
  assert.deepEqual(innoCommentFailures("a.iss", HEAD), []);
  assert.deepEqual(lines(innoCommentFailures("a.iss", "[Setup]\nAppName=x\n")), [1]);
  assert.equal(headerLineCount("a.iss", "; one\n; two\n\n[Setup]\n"), 2);
  assert.equal(headerLineCount("a.iss", "[Setup]\n; late\n"), 0);
});

test("comments are allowed only above a routine: not in sections, bodies or the var list", () => {
  const text = `${HEAD}var\n  { global }\n  X: Boolean;\n\n{ doc }\n${routine("A", "  { in body }\n  Result := True;")}`;
  assert.deepEqual(lines(innoCommentFailures("a.iss", text)), [8, 14]);
  assert.deepEqual(lines(innoCommentFailures("a.iss", "; h\n[Files]\n; entry note\nSource: a\n")), [3]);
  assert.deepEqual(lines(commentFailures({ key: "a.iss", text: `${HEAD}// loose\n` })), [7]);
});

test("a routine at the limits passes and one past them fails", () => {
  const ok = routine("A", Array.from({ length: 36 }, () => "  Result := True;").join("\n"));
  assert.deepEqual(innoMetricFailures("a.iss", HEAD + ok), []);
  const long = routine("A", Array.from({ length: 38 }, () => "  Result := True;").join("\n"));
  assert.deepEqual(innoMetricFailures("a.iss", HEAD + long), ["a.iss:7 A has 41 NLOC > 40"]);
});

test("complexity counts branches and logic operators, not words in strings or comments", () => {
  const branches = (count: number) => Array.from({ length: count }, (_, index) => `  if X = ${index} then Result := True;`).join("\n");
  assert.deepEqual(innoMetricFailures("a.iss", HEAD + routine("A", branches(7))), []);
  assert.deepEqual(innoMetricFailures("a.iss", HEAD + routine("A", branches(8))), ["a.iss:7 A complexity 9 > 8"]);
  const words = "  Result := 'if and or while for'; // if and or\n  { if if if if if if if if if if }";
  assert.deepEqual(innoMetricFailures("a.iss", HEAD + routine("A", words)), []);
});

test("nesting counts begin, try, repeat and case blocks inside the routine", () => {
  const nested = (depth: number) => Array.from({ length: depth }, () => "if X then begin").join("\n") + "\n  Y;\n" + "end;\n".repeat(depth);
  assert.deepEqual(innoMetricFailures("a.iss", HEAD + routine("A", nested(3))), []);
  assert.deepEqual(innoMetricFailures("a.iss", HEAD + routine("A", nested(4))), ["a.iss:7 A nests 4 deep > 3"]);
});

test("parameters are counted per name across var and const groups", () => {
  assert.deepEqual(innoMetricFailures("a.iss", HEAD + routine("A", "  Y;", "(const A, B: String; var C: Integer; D: Boolean)")), []);
  assert.deepEqual(innoMetricFailures("a.iss", HEAD + routine("A", "  Y;", "(const A, B: String; var C, D: Integer; E: Boolean)")), ["a.iss:7 A has 5 parameters; pass one record"]);
});

test("a file over 400 lines of code fails", () => {
  const entries = Array.from({ length: 400 }, (_, index) => `Name${index}=x`).join("\n");
  assert.deepEqual(innoMetricFailures("a.iss", `; h\n\n[Setup]\n${entries}\n`), ["a.iss: 401 NLOC > 400"]);
});
