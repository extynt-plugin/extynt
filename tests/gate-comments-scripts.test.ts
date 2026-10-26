// scripts/lib/comments/script-comments.ts: the header and function-comment policy for shell and PowerShell files.
import assert from "node:assert/strict";
import test from "node:test";
import { scriptCommentFailures } from "../scripts/lib/comments/script-comments.ts";
import { scanPowershell } from "../scripts/lib/comments/powershell-lexer.ts";

const failures = (key: string, text: string) => scriptCommentFailures(key, text);
interface ScannedComment {
  readonly text: string;
}

const hasCarriageReturn = (comments: readonly ScannedComment[]) => comments.some((comment) => comment.text.includes("\r"));
const lines = (found: readonly string[]) => found.map((failure: string) => Number(failure.split(":")[1]));

test("a header after the shebang, then a comment above a function, passes", () => {
  const text = "#!/usr/bin/env bash\n# Builds it.\nset -euo pipefail\n\n# Prints a line.\nsay() {\n  echo \"$1\"\n}\n";
  assert.deepEqual(failures("a.sh", text), []);
});

test("a header between set and the first statement passes", () => {
  assert.deepEqual(failures("a.sh", "#!/usr/bin/env bash\nset -euo pipefail\n# Builds it.\necho hi\n"), []);
});

test("a script without a header fails", () => {
  assert.deepEqual(lines(failures("a.sh", "#!/usr/bin/env bash\nset -euo pipefail\necho hi\n")), [1]);
});

test("a shellcheck source directive is always allowed", () => {
  const text = "#!/usr/bin/env bash\n# Builds it.\nset -euo pipefail\n# shellcheck source=lib.sh\nsource ./lib.sh\n";
  assert.deepEqual(failures("a.sh", text), []);
});

test("a comment in a function body, a trailing comment and a stray comment fail", () => {
  const text = "#!/usr/bin/env bash\n# Builds it.\nset -euo pipefail\nf() {\n  # why\n  echo hi # note\n}\n# stray\n\necho done\n";
  assert.deepEqual(lines(failures("a.sh", text)), [5, 6, 8]);
});

test("a hash in a quote, an expansion or a heredoc is not a comment", () => {
  const text = "#!/usr/bin/env bash\n# Builds it.\nset -euo pipefail\nx=\"a # b\"\necho ${#x} $#\ncat <<EOF\n# data\nEOF\necho 'it # is'\n";
  assert.deepEqual(failures("a.sh", text), []);
});

test("PowerShell takes a header, a function comment and block comments", () => {
  const text = "<# Installs it. #>\n# Copies files.\nfunction Copy-It {\n  $x = '#no'\n}\n";
  assert.deepEqual(failures("a.ps1", text), []);
  assert.deepEqual(lines(failures("a.ps1", "# h\nfunction A {\n  $x = 1 # note\n}\n")), [3]);
});

test("CRLF line endings give the same verdicts as LF for shell and PowerShell", () => {
  const sources = new Map([
    ["a.ps1", "<# Installs it. #>\n# Copies files.\nfunction Copy-It {\n  $x = '#no'\n  $y = 1 # note\n}\n$h = @'\n# data\n'@\n"],
    ["a.sh", "#!/usr/bin/env bash\n# Builds.\nset -e\nf() {\n  # why\n  cat <<EOF\n# data\nEOF\n}\n"],
  ]);
  for (const [key, text] of sources) assert.deepEqual(failures(key, text.replaceAll("\n", "\r\n")), failures(key, text), key);
});

test("a CRLF PowerShell script keeps carriage returns out of the comments it reads", () => {
  const text = "# Builds it.\r\n#\r\n# Usage: build.ps1 -Arch x64\r\nfunction Build-It {\r\n  1\r\n}\r\n\r\n# Cleans up.\r\nfunction Clean-It {\r\n  2\r\n}\r\n";
  assert.deepEqual(failures("build.ps1", text), []);
  const { comments } = scanPowershell(text);
  assert.equal(comments.length, 4);
  assert.equal(hasCarriageReturn(comments), false);
});
