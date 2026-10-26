// The decision log's per-call fields: each row names the moment and job that asked and the questions its call sent, and never carries request text.
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearBook } from "../src/decision-book.js";
import { primeJobOpen } from "../src/decision-prime.js";
import { primeContinuation } from "../src/decision-continuation.js";
import { scriptedModel, serviceOver, yesNo } from "./decision-fakes.js";

beforeEach(() => clearBook());

const REQUEST = "make the title glow and draw a bar chart of the sales figures";

test("the job-open batch is logged under job-open with the job id and the batch's question count", async () => {
  const { service, rows } = serviceOver([scriptedModel(() => yesNo(true)).model]);
  await primeJobOpen(service, { request: REQUEST, message: REQUEST }, "job-7");
  assert.ok(rows.length > 1, "the job-open batch settles more than one decision");
  for (const row of rows) {
    assert.equal(row.moment, "job-open");
    assert.equal(row.jobId, "job-7");
    assert.equal(row.questions, rows.length);
  }
});

test("a continuation with no job id at hand logs a null job id", async () => {
  const { service, rows } = serviceOver([scriptedModel(() => yesNo(true)).model]);
  await primeContinuation(service, "mach bitte weiter");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.moment, "continuation");
  assert.equal(rows[0]?.jobId, null);
});

test("no logged row carries the request text", async () => {
  const { service, rows } = serviceOver([scriptedModel(() => yesNo(true)).model]);
  await primeJobOpen(service, { request: REQUEST, message: REQUEST }, "job-8");
  assert.ok(rows.length > 0);
  for (const row of rows) assert.ok(!JSON.stringify(row).includes("bar chart"));
});
