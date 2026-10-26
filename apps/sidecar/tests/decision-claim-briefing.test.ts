// The state-claim decision at job open: Jev answers it for any language, the briefing flag follows that answer, and the deterministic check stands in when no model answered.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot } from "@extynt/project-graph";
import { buildAgentBriefing } from "../src/agent-briefing.js";
import { bookedYesNo, clearBook } from "../src/decision-book.js";
import { primeJobOpen } from "../src/decision-prime.js";
import { scriptedModel, serviceOver, yesNo } from "./decision-fakes.js";

const GERMAN = "Der Titel ist abgeschnitten und ich habe zu weit rückgängig gemacht.";
const UNREAD = "Der Rand wirkt heute irgendwie anders als gestern.";
const FLAG = "This request makes such a claim";

beforeEach(() => clearBook());

const flagged = (options: { requestGoal: string; claimBooked?: boolean }): boolean => buildAgentBriefing(representativeSnapshot, options).includes(FLAG);

test("the batch asks the claim question and books the model's answer for a German request", async () => {
  const jev = scriptedModel((question) => yesNo(question.id === "asserts-current-state"));
  await primeJobOpen(serviceOver([jev.model]).service, { request: GERMAN, message: GERMAN });
  assert.ok(jev.calls[0]?.questions.some((question) => question.id === "asserts-current-state"));
  assert.equal(bookedYesNo({ decision: "asserts-current-state", text: GERMAN }), true);
});

test("the booked answer decides the briefing flag, in either direction", () => {
  assert.equal(flagged({ requestGoal: UNREAD }), false, "the deterministic fallback reads only the claim wordings it knows");
  assert.equal(flagged({ requestGoal: UNREAD, claimBooked: true }), true);
  assert.equal(flagged({ requestGoal: "it's not a circle", claimBooked: false }), false);
  assert.equal(flagged({ requestGoal: "it's not a circle" }), true, "no booked answer falls back to the deterministic check");
});
