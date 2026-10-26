/** Decision token usage: one model call books its input tokens once, on the first log row of that call and in the chat turn's decisions role. */
import assert from "node:assert/strict";
import test from "node:test";
import { binary, type Answer, type DecisionKind, type DecisionModel, type JsonValue } from "@extynt/decide";
import { rowTokens } from "../src/decision-calls.js";
import type { DecisionLogRow, DecisionSite } from "../src/decision-log.js";
import { DecisionService } from "../src/decision-service.js";
import { inRequestScope } from "../src/request-scope.js";
import { SpecialistUsageLedger } from "../src/server-turn-usage.js";
import { yesNo } from "./decision-fakes.js";

const JEV_TOKENS = 321;
const SITE: DecisionSite = { moment: "job-open", jobId: null };
const PROBES = {
  alpha: binary<JsonValue>({ name: "probe-alpha", instructions: "Is it alpha?", deterministic: () => false }),
  beta: binary<JsonValue>({ name: "probe-beta", instructions: "Is it beta?", deterministic: () => false }),
  gamma: binary<JsonValue>({ name: "probe-gamma", instructions: "Is it gamma?", deterministic: () => false }),
};

function jevLike(): DecisionModel {
  return {
    id: "jev",
    tier: "decision-model",
    supports: new Set<DecisionKind>(["binary"]),
    calibrated: true,
    threshold: 0.5,
    async decide(_state, questions) {
      const answers = new Map<string, Answer>(questions.map((question) => [question.id, yesNo(true)]));
      return { ok: true, answers, usage: { model: "jev-1.14.0", inputTokens: JEV_TOKENS } };
    },
  };
}

function serviceWith(models: ReadonlyArray<DecisionModel>, rows: DecisionLogRow[], usage?: SpecialistUsageLedger): DecisionService {
  return new DecisionService({ models: () => models, log: { record: (batch) => { rows.push(...batch); } }, now: () => new Date(0), ...(usage === undefined ? {} : { usage }) });
}

test("one model call answering three questions books its input tokens on the first log row only", async () => {
  const rows: DecisionLogRow[] = [];
  await serviceWith([jevLike()], rows).decideAll({ text: "glow" }, PROBES, SITE);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.tier === "decision-model"), "every answer came from the model, so the tokens belong to it");
  assert.deepEqual(rows.map((row) => row.inputTokens), [JEV_TOKENS, null, null]);
  assert.deepEqual(rows.map((row) => row.model), ["jev-1.14.0", "jev-1.14.0", "jev-1.14.0"]);
});

test("a deterministic row carries no model and no input tokens", async () => {
  const rows: DecisionLogRow[] = [];
  await serviceWith([], rows).decideAll({ text: "glow" }, PROBES, SITE);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.model === null && row.inputTokens === null));
});

test("a chat turn's decisions role counts each model call once, with its input tokens and no output", async () => {
  const ledger = new SpecialistUsageLedger();
  const service = serviceWith([jevLike()], [], ledger);
  await inRequestScope("turn-one", () => service.decideAll({ text: "glow" }, PROBES, SITE));
  const decisions = ledger.take("turn-one").find((role) => role.role === "decisions");
  assert.deepEqual(decisions, { role: "decisions", model: "jev-1.14.0", provider: "jev", calls: 1, inputTokens: JEV_TOKENS, cachedInputTokens: 0, outputTokens: 0, reported: true });
});

test("the decisions role sums the turn's calls, one per batch", async () => {
  const ledger = new SpecialistUsageLedger();
  const service = serviceWith([jevLike()], [], ledger);
  await inRequestScope("turn-two", async () => {
    await service.decideAll({ text: "glow" }, PROBES, SITE);
    await service.decideAll({ text: "blur" }, PROBES, SITE);
  });
  const decisions = ledger.take("turn-two").find((role) => role.role === "decisions");
  assert.equal(decisions?.calls, 2);
  assert.equal(decisions?.inputTokens, 2 * JEV_TOKENS);
});

test("decisions made outside a chat turn are booked to no turn", async () => {
  const ledger = new SpecialistUsageLedger();
  await serviceWith([jevLike()], [], ledger).decideAll({ text: "glow" }, PROBES, SITE);
  assert.deepEqual(ledger.take("turn-three"), []);
});

test("a chat turn that made no model call has no decisions role", async () => {
  const ledger = new SpecialistUsageLedger();
  await inRequestScope("turn-four", () => serviceWith([], [], ledger).decideAll({ text: "glow" }, PROBES, SITE));
  assert.deepEqual(ledger.take("turn-four"), []);
});

test("concurrent chat turns each book their own decision calls", async () => {
  const ledger = new SpecialistUsageLedger();
  const service = serviceWith([jevLike()], [], ledger);
  await Promise.all([
    inRequestScope("turn-a", () => service.decideAll({ text: "glow" }, PROBES, SITE)),
    inRequestScope("turn-b", async () => {
      await service.decideAll({ text: "blur" }, PROBES, SITE);
      await service.decideAll({ text: "grain" }, PROBES, SITE);
    }),
  ]);
  assert.equal(ledger.take("turn-a").find((role) => role.role === "decisions")?.calls, 1);
  assert.equal(ledger.take("turn-b").find((role) => role.role === "decisions")?.calls, 2);
});

test("rowTokens books each provider's calls on its first row and leaves providers without a call null", () => {
  const tokens = rowTokens(["jev", null, "jev", "other"], [
    { provider: "jev", model: null, inputTokens: 10 },
    { provider: "jev", model: null, inputTokens: 5 },
  ]);
  assert.deepEqual(tokens, [15, null, null, null]);
});

test("a call that reported no input tokens books null, and the decisions role is not reported", async () => {
  const ledger = new SpecialistUsageLedger();
  const silent: DecisionModel = { ...jevLike(), async decide(_state, questions) {
    return { ok: true, answers: new Map<string, Answer>(questions.map((question) => [question.id, yesNo(true)])), usage: { model: null, inputTokens: null } };
  } };
  await inRequestScope("turn-silent", () => serviceWith([silent], [], ledger).decideAll({ text: "glow" }, PROBES, SITE));
  const decisions = ledger.take("turn-silent").find((role) => role.role === "decisions");
  assert.equal(decisions?.calls, 1);
  assert.equal(decisions?.inputTokens, 0);
  assert.equal(decisions?.reported, false);
});
