// What the agent owes the user: check a stated claim before acting on it, say when a named font was replaced, and get a pointer to the real tool after a wrong tool name.
import assert from "node:assert/strict";
import test from "node:test";
import { makeFontInventory, makeHostProfile, makeInventory, makePresetInventory } from "@extynt/capability-catalogue";
import { representativeSnapshot } from "@extynt/project-graph";
import { buildAgentBriefing } from "../src/agent-briefing.js";
import { unknownToolHint } from "../src/agent-tool-surface.js";
import { fontDisclosure } from "../src/server-workflow-font-guard.js";

const HOST = { application: "After Effects" as const, version: "26.2.1", buildNumber: "2", platform: "Windows", architecture: "x64" };
const record = (family: string, style: string) => ({ family, style, postScriptName: `${family.replace(/\s+/g, "")}-${style.replace(/\s+/g, "")}` });

function profileWith(completeness: "complete" | "partial") {
  const fonts = makeFontInventory([record("Arial", "Regular"), record("Arial", "Bold Italic"), record("Verdana", "Regular")], { completeness, familiesReported: 2 });
  return makeHostProfile(makeInventory(HOST, []), undefined, makePresetInventory([]), fonts);
}

function claimRuleOf(goal: string): string {
  return buildAgentBriefing(representativeSnapshot, { requestGoal: goal }).split("\n").find((line) => /^1[56]\. A claim in the request/u.test(line)) ?? "";
}

test("the briefing always tells the agent to verify a stated claim and to ask before overriding it", () => {
  const rule = claimRuleOf("Add a glow to the title");
  assert.match(rule, /is verified, not believed/);
  assert.match(rule, /ae_measure_layer/);
  assert.match(rule, /Contradicted: change nothing/);
  assert.match(rule, /ae_ask_user/);
  assert.doesNotMatch(rule, /This request makes such a claim/);
});

test("a request that asserts the present state is flagged in the rule", () => {
  for (const goal of ["start on 0 instead of 1 second", "I undid too far", "it's not a circle, it looks like an octagon"]) {
    assert.match(claimRuleOf(goal), /This request makes such a claim: check it first/, goal);
  }
});

test("the stand-in rule requires saying what was missing, the stand-in and the alternatives", () => {
  const briefing = buildAgentBriefing(representativeSnapshot, {});
  assert.match(briefing, /what you used, the closest alternatives/);
});

test("a complete census without the named font yields a disclosure note naming alternatives", () => {
  const note = fontDisclosure(profileWith("complete"), "add a text layer in visby bold italics");
  assert.match(note ?? "", /"visby", which is not installed on this host/);
  assert.match(note ?? "", /Your reply must say so, name the font you used instead/);
  assert.match(note ?? "", /Arial/);
});

test("no disclosure when the font is installed, the census is partial or no font is named", () => {
  assert.equal(fontDisclosure(profileWith("complete"), "make the title in Arial bold"), undefined);
  assert.equal(fontDisclosure(profileWith("partial"), "add a text layer in visby bold italics"), undefined);
  assert.equal(fontDisclosure(profileWith("complete"), "add a glow to the title"), undefined);
  assert.equal(fontDisclosure(undefined, "add a text layer in visby bold italics"), undefined);
});

test("an invented wrapper tool name points at calling the real tool directly", () => {
  const hint = unknownToolHint("ae_call_tool", ["ae_status", "ae_inspect_layer"]);
  assert.match(hint, /no wrapper tool this turn: call the tool you want directly/);
  assert.match(hint, /ae_status/);
  assert.match(unknownToolHint("ae_call_tool_placeholder", ["ae_status", "ae_call_tool"]), /takes the real tool's exact name/);
});

test("a misspelt tool name names the nearest offered tools", () => {
  const hint = unknownToolHint("ae_measure_shape", ["ae_measure_layer", "ae_inspect_layer", "ae_status"]);
  assert.match(hint, /Did you mean ae_measure_layer\?/);
  assert.equal(unknownToolHint("zzz", ["ae_status"]), "");
});
