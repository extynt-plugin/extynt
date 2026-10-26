// Text and path redaction: what the package strips before anything reaches a provider.
import assert from "node:assert/strict";
import test from "node:test";
import { decodeOrThrow, string } from "@extynt/decode";
import { redactText } from "../src/index.js";
import type { RedactedValue, RedactionConfig } from "../src/redaction.js";

function textOf(result: RedactedValue): string {
  return decodeOrThrow(string(), result.value);
}

test("redaction removes secrets, paths, and oversized strings", () => {
  const result = redactText("token=sk-proj-123456789 /Users/alice/project/file.aep " + "x".repeat(300));
  assert.match(textOf(result), /\[redacted secret\]/);
  assert.match(textOf(result), /\[redacted path\]/);
  assert.equal(result.report.redactedSecretCount, 1);
  assert.equal(result.report.redactedPathCount, 1);
  assert.equal(result.report.truncatedStringCount, 1);
});

test("redactText keeps the default length cap when a caller passes an explicit undefined", () => {
  const unset: Partial<RedactionConfig> = {};
  Object.assign(unset, { maxStringLength: undefined });
  const capped = redactText("x".repeat(500), unset);
  assert.equal((textOf(capped)).length, 240);
  assert.equal(capped.report.truncatedStringCount, 1);
  const explicit = redactText("x".repeat(500), { maxStringLength: 10 });
  assert.equal((textOf(explicit)).length, 10, "an explicit number still overrides the default");
});

test("path redaction covers a whole path containing spaces without eating the surrounding prose", () => {
  const spaced = redactText("Source missing: /Users/alice/My Project/footage/hero.png");
  assert.equal(spaced.value, "Source missing: [redacted path]");
  assert.equal(spaced.report.redactedPathCount, 1);
  const windows = redactText("Source missing: C:\\Users\\alice\\My Documents\\proj.aep for details");
  assert.equal(windows.value, "Source missing: [redacted path] for details");
  const prose = redactText("Open /Users/alice/hero.png and tell me what you see");
  assert.equal(prose.value, "Open [redacted path] and tell me what you see");
});

test("path redaction covers a final spaced path segment instead of leaking its tail", () => {
  const finalSpaced = redactText("Source missing: /Users/alice/My Folder exists");
  assert.equal(finalSpaced.value, "Source missing: [redacted path]");
  assert.equal(finalSpaced.report.redactedPathCount, 1);
  const endOfMessage = redactText("Source missing: /Users/alice/My Folder");
  assert.equal(endOfMessage.value, "Source missing: [redacted path]");
  const multiWord = redactText("Source missing: /Users/alice/My Big Folder exists");
  assert.equal(multiWord.value, "Source missing: [redacted path]");
  const complete = redactText("Source missing: /Users/alice/My Project/hero.png exists");
  assert.equal(complete.value, "Source missing: [redacted path] exists");
  const twoLines = redactText("Source missing: /Users/alice/My Folder\nexists");
  assert.equal(twoLines.value, "Source missing: [redacted path]\nexists");
});

test("path redaction keeps a dotted path component instead of reading the dot as a file extension", () => {
  const dated = redactText("Source missing: /Users/alice/backup.2024 Footage and more");
  assert.equal(dated.value, "Source missing: [redacted path]");
  assert.equal(dated.report.redactedPathCount, 1);
  const versioned = redactText("Source missing: /Users/alice/My Folder.v2 more text");
  assert.equal(versioned.value, "Source missing: [redacted path]");
  assert.equal(versioned.report.redactedPathCount, 1);
});

test("path redaction covers a middle component of three or more words", () => {
  const workInProgress = redactText("Source missing: /Volumes/Work in Progress/render.aep");
  assert.equal(workInProgress.value, "Source missing: [redacted path]");
  assert.equal(workInProgress.report.redactedPathCount, 1);
  const bigProject = redactText("Source missing: /Volumes/My Big Project/footage/hero.png");
  assert.equal(bigProject.value, "Source missing: [redacted path]");
  assert.equal(bigProject.report.redactedPathCount, 1);
  const windows = redactText("Source missing: C:\\Users\\alice\\My Big Documents\\proj.aep");
  assert.equal(windows.value, "Source missing: [redacted path]");
});

test("path redaction covers a quoted path", () => {
  const doubleQuoted = redactText('Source missing: "/Users/alice/My Folder"');
  assert.equal(doubleQuoted.value, 'Source missing: "[redacted path]"');
  assert.equal(doubleQuoted.report.redactedPathCount, 1);
  const singleQuoted = redactText("Source missing: '/Users/alice/My Folder'");
  assert.equal(singleQuoted.value, "Source missing: '[redacted path]'");
  assert.equal(singleQuoted.report.redactedPathCount, 1);
  const followedByProse = redactText('Source missing: "/Users/alice/My Folder" exists');
  assert.equal(followedByProse.value, 'Source missing: "[redacted path]" exists');
  const apostrophe = redactText("Source missing: /Users/alice/John's Files/render.aep");
  assert.equal(apostrophe.value, "Source missing: [redacted path]");
});

test("path redaction leaves prose that merely contains a slash alone", () => {
  const ratio = redactText("The comp is 1920 x 1080 and the ratio is 16/9");
  assert.equal(ratio.value, "The comp is 1920 x 1080 and the ratio is 16/9");
  assert.equal(ratio.report.redactedPathCount, 0);
  const relative = redactText("Run pnpm build && node --test packages/llm/dist/tests/*.test.js");
  assert.equal(relative.value, "Run pnpm build && node --test packages/llm/dist/tests/*.test.js");
  assert.equal(relative.report.redactedPathCount, 0);
  const prose = redactText("Open /Users/alice/hero.png and tell me what you see");
  assert.equal(prose.value, "Open [redacted path] and tell me what you see");
});
