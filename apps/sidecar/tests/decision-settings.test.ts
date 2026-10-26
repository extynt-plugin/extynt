// The decision-model setting and the decision log: the layered environment configures the models, no key configures none, and the log keeps decisions and never keys.
import { fittedBands } from "@extynt/decide";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileDecisionLog, DECISION_LOG_FILE } from "../src/decision-log.js";
import { decisionModelsOf } from "../src/decision-settings.js";

function withDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "extynt-decisions-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("with no key in any layer there is no decision model", () => {
  withDirectory((directory) => {
    const models = decisionModelsOf({ filePath: join(directory, "llm.env"), processEnv: {} });
    assert.equal(models().length, 0);
  });
});

test("a TypeSafe key in the process environment configures the decision model, and one in llm.env does the same", () => {
  withDirectory((directory) => {
    assert.equal(decisionModelsOf({ filePath: join(directory, "llm.env"), processEnv: { TYPESAFE_API_KEY: "key-one" } })().length, 1);
    writeFileSync(join(directory, "llm.env"), "TYPESAFE_API_KEY=key-two\n");
    assert.equal(decisionModelsOf({ filePath: join(directory, "llm.env"), processEnv: {} })().length, 1);
  });
});

test("the models are rebuilt only when a setting changes", () => {
  withDirectory((directory) => {
    const models = decisionModelsOf({ filePath: join(directory, "llm.env"), processEnv: { TYPESAFE_API_KEY: "key-one" } });
    assert.equal(models(), models());
  });
});

test("the log appends one line per decision with no key in it", () => {
  withDirectory((directory) => {
    fileDecisionLog(directory).record([{ at: "2026-10-24T00:00:00.000Z", decision: "drawn-scene", moment: "job-open", jobId: null, questions: 1, image: false, tier: "decision-model", provider: "jev", answer: "drawn-scene", confidence: 0.9, band: "act", abstained: false, fallback: null, latencyMs: 120, model: "jev-1.14.0", inputTokens: 321 }]);
    const lines = readFileSync(join(directory, DECISION_LOG_FILE), "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.ok(lines[0]?.includes("\"decision\":\"drawn-scene\""));
    assert.ok(!lines[0]?.includes("key-one"));
  });
});

test("the fitted bands are kept for the decisions that were fitted and absent for others", () => {
  assert.deepEqual(fittedBands("question-answered"), { verify: 0.9, act: 0.9 });
  assert.equal(fittedBands("modal-risk"), undefined);
});
