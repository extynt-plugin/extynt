// The request log keeps the user's words and layout, redacts secrets, orders follow-ups after the original and survives a restart.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REQUEST_LOG_LATER_BYTES, WorkflowRequestLog } from "../src/server-workflow-request-log.js";

const JOB = "wf-job-0123456789abcdef01234567";

test("the request log keeps the user's words and layout, redacting only secrets", () => {
  const log = new WorkflowRequestLog(undefined);
  log.append(JOB, "Scene 1:\n  a red ball bounces\n\napi_key=sk-abcdefghijklmnopqrstuvwx");
  const text = log.text(JOB) ?? "";
  assert.match(text, /Scene 1:\n {2}a red ball bounces\n\n/);
  assert.doesNotMatch(text, /sk-abcdefghijklmnopqrstuvwx/);
});

test("follow-ups come after the original request, newest kept when they overflow", () => {
  const log = new WorkflowRequestLog(undefined);
  log.append(JOB, "make the film");
  const big = "x".repeat(REQUEST_LOG_LATER_BYTES / 2);
  log.append(JOB, `first ${big}`);
  log.append(JOB, `second ${big}`);
  log.append(JOB, "third: make the ball blue");
  const text = log.text(JOB) ?? "";
  assert.match(text, /^The user's request:\nmake the film/);
  assert.match(text, /1 earlier follow-up message is not repeated here/);
  assert.match(text, /third: make the ball blue$/);
  assert.equal(log.text("wf-job-ffffffffffffffffffffffff"), undefined);
});

test("the request log survives a restart", () => {
  const directory = join(mkdtempSync(join(tmpdir(), "extynt-requests-")), "workflow-requests");
  new WorkflowRequestLog(directory).append(JOB, "build all five scenes");
  assert.match(new WorkflowRequestLog(directory).text(JOB) ?? "", /build all five scenes/);
});
