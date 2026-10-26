// The decision log summariser: calls are grouped per service call, the per-moment and per-job tables add up, and lines that do not decode are skipped.
import assert from "node:assert/strict";
import test from "node:test";
import { formatDecisionLogSummary, summarizeDecisionLog } from "../src/decision-log-summary.js";

function row(fields: { at: string; moment: string; jobId: string | null; questions: number; latencyMs: number; decision?: string }): string {
  return JSON.stringify({ decision: "d", tier: "decision-model", provider: "jev", answer: "a", confidence: 0.9, band: "act", fallback: null, ...fields });
}

const LOG = [
  row({ at: "t1", moment: "job-open", jobId: "job-a", questions: 2, latencyMs: 100, decision: "request-parts" }),
  row({ at: "t1", moment: "job-open", jobId: "job-a", questions: 2, latencyMs: 100, decision: "request-scale" }),
  row({ at: "t2", moment: "job-open", jobId: "job-a", questions: 1, latencyMs: 300 }),
  row({ at: "t3", moment: "build-kit", jobId: null, questions: 1, latencyMs: 50 }),
  row({ at: "t4", moment: "completion", jobId: "job-b", questions: 1, latencyMs: 20 }),
  "{\"at\": \"t5\", \"moment\": \"not-a-moment\"}",
  "",
].join("\n");

test("calls are grouped per service call, and questions count once per call", () => {
  const summary = summarizeDecisionLog(LOG);
  assert.equal(summary.rows, 5);
  assert.equal(summary.calls, 4);
  assert.equal(summary.skipped, 1);
});

test("the per-moment table gives calls, questions and the median and p95 latency", () => {
  const jobOpen = summarizeDecisionLog(LOG).moments.find((moment) => moment.moment === "job-open");
  assert.deepEqual(jobOpen, { moment: "job-open", calls: 2, questions: 3, medianMs: 200, p95Ms: 300 });
  const kit = summarizeDecisionLog(LOG).moments.find((moment) => moment.moment === "build-kit");
  assert.deepEqual(kit, { moment: "build-kit", calls: 1, questions: 1, medianMs: 50, p95Ms: 50 });
});

test("the per-job table counts calls and questions, and rows with no job fall under none", () => {
  const jobs = summarizeDecisionLog(LOG).jobs;
  assert.deepEqual(jobs, [
    { jobId: "job-a", calls: 2, questions: 3 },
    { jobId: "none", calls: 1, questions: 1 },
    { jobId: "job-b", calls: 1, questions: 1 },
  ]);
});

test("an empty log summarises to nothing, and the text form names each moment", () => {
  const empty = summarizeDecisionLog("");
  assert.deepEqual([empty.rows, empty.calls, empty.moments.length, empty.jobs.length], [0, 0, 0, 0]);
  const text = formatDecisionLogSummary(summarizeDecisionLog(LOG));
  assert.ok(text.includes("job-open"));
  assert.ok(text.includes("median 200 ms  p95 300 ms"));
});
