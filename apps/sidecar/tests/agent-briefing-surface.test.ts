/** What the agent is told about its tools and runtime: the in-panel tool list derived from the external one, the guides, the panel-mode state, and the first message the model receives, byte for byte. The message a turn builds lives in the agent-* modules beside the agent.ts barrel, which the source scan reads. */
import { MockProvider, splitTransient } from "@extynt/llm";
import { IN_PANEL_AGENT_HIDDEN_TOOLS, TOOL_DEFINITIONS } from "@extynt/mcp-server";
import { representativeSnapshot } from "@extynt/project-graph";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { AGENT_GUIDES } from "../src/agent-guides.js";
import { buildAgentBriefing, buildAgentBriefingSegments } from "../src/agent-briefing.js";
import { AGENT_CHAT_TOOLS, AGENT_VISION_TOOLS } from "../src/agent-policy.js";
import { agentToolSpecs } from "../src/agent-tool-specs.js";
import { authorization, chatTurn, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";

test("the in-panel agent's tools are derived, so the two surfaces cannot drift", () => {
  const offered = AGENT_CHAT_TOOLS;

  const every = TOOL_DEFINITIONS.map((tool) => tool.name);
  assert.equal(offered.length, every.length - IN_PANEL_AGENT_HIDDEN_TOOLS.size - AGENT_VISION_TOOLS.size, "every tool is offered, minus the plan lifecycle and vision");
  for (const name of every) {
    if (IN_PANEL_AGENT_HIDDEN_TOOLS.has(name)) { assert.ok(!offered.includes(name), `${name} is a plan-lifecycle tool and is not in this model's namespace`); continue; }
    if (AGENT_VISION_TOOLS.has(name)) continue;
    assert.ok(offered.includes(name), `${name} must be offered to the in-panel agent`);
  }

  for (const tool of ["ae_get_project_overview", "ae_status", "ae_get_bootstrap_context", "ae_refresh_snapshot", "ae_list_native_operations", "ae_get_effect_controls", "ae_get_host_profile_summary", "ae_get_host_profile_status", "ae_get_inventory_diff", "ae_resolve_capability"]) {
    assert.ok(offered.includes(tool), `${tool} must be offered to the in-panel agent`);
  }

  for (const tool of ["ae_queue_add", "ae_queue_fix", "ae_queue_finish", "ae_recall_plan", "ae_undo_agent_work"]) {
    assert.ok(offered.includes(tool), `${tool} is part of the in-panel agent's surface`);
  }
  for (const tool of ["ae_propose_plan", "ae_plan_create", "ae_plan_add", "ae_plan_complete", "ae_amend_plan", "ae_get_plan_status", "ae_approve_plan", "ae_cancel_plan", "ae_get_receipt", "ae_undo_plan", "ae_present_plan", "ae_list_plans", "ae_prepare_change", "ae_get_fresh_edit_context"]) {
    assert.ok(!offered.includes(tool), `${tool} is not on the in-panel agent's surface`);
  }
  const withImages = agentToolSpecs({ acceptsImages: true }).map((spec) => spec.name);
  assert.ok(withImages.includes("ae_queue_finish"), "and declaring image support only adds the picture");
  assert.ok(agentToolSpecs({ acceptsImages: false }).some((spec) => spec.name === "ae_capture_composition_frame"), "a text-only model still captures, so ae_observe_frame has a frame to measure");
  assert.ok(!agentToolSpecs().some((spec) => spec.name === "ae_select_workflow_stage"), "the legacy in-panel harness does not receive workflow controls");
  const workflowTools = agentToolSpecs({ workflowStage: true }).map((spec) => spec.name);
  assert.ok(!workflowTools.includes("ae_select_workflow_stage"), "workflow-v1 opens its stage itself and no longer offers the handshake");
  assert.ok(workflowTools.includes("ae_ask_user"), "workflow-v1 still offers the question tool");

  for (const tool of AGENT_VISION_TOOLS) {
    assert.ok(!offered.includes(tool), `${tool} is a vision tool and must be off by default`);
    assert.ok(!agentToolSpecs().some((spec) => spec.name === tool), `${tool} must not be sent without declared image support`);
    assert.ok(withImages.includes(tool), `${tool} should be offered once a model declares it accepts images`);
  }
});

test("the agent guide states both expression/keyframe directions and the limits of expression evidence", () => {
  const briefing = buildAgentBriefing(representativeSnapshot);

  assert.match(briefing, /ignores new keyframes/);

  assert.match(briefing, /readable reference data/);
  assert.match(briefing, /valueAtTime/);
  assert.doesNotMatch(briefing, /supersedes those keys/);

  assert.match(briefing, /sourceRectAtTime/);
  assert.doesNotMatch(briefing, /Text-box size is observable/i);
  assert.match(briefing, /can confirm the write/);
  assert.match(briefing, /never the motion it computes/);
  assert.match(briefing, /dynamic output/);
});

test("the agent guide separates an implemented operation from an effect this host can apply unattended", () => {
  const briefing = buildAgentBriefing(representativeSnapshot);

  assert.match(briefing, /cannot be added unattended/);
  assert.match(briefing, /refuses those/);
  assert.match(briefing, /add (that one|it) by hand/i);

  assert.match(AGENT_GUIDES.expressions, /set_expression also targets an exact effect control/, "the detail moved to the on-demand guide");
});

test("panel mode is trusted runtime state, never text inside the user's message", () => {

  const on = buildAgentBriefingSegments(representativeSnapshot, { autoApply: true });
  const off = buildAgentBriefingSegments(representativeSnapshot, { autoApply: false });
  const [onStable, onLive] = on;
  const [offStable, offLive] = off;
  assert.ok(onStable && onLive && offStable && offLive, "both halves exist in each mode");
  assert.equal(onStable.text, offStable.text, "the cacheable half must not depend on panel mode");
  assert.equal(onStable.cache, true);
  assert.doesNotMatch(onStable.text, /autoApply/);
  assert.equal(onLive.cache, undefined, "the runtime half is not cached: it changes with the toggle");
  assert.match(onLive.text, /Runtime state \(the panel's own; trusted/, "and it says whose state it is");
  assert.match(onLive.text, /autoApply: ON/);
  assert.match(offLive.text, /autoApply: OFF/);

  assert.match(onLive.text, /each queue you finish/i);
  assert.match(onLive.text, /in the order you finish them/i);
  assert.match(onLive.text, /never offer an alternative/i);
  assert.match(onLive.text, /never tell the user to press Apply/i);
  assert.match(offLive.text, /Apply button/i);

  const agentDirectory = existsSync(join(process.cwd(), "src/agent.ts")) ? join(process.cwd(), "src") : join(process.cwd(), "apps/sidecar/src");
  const source = readdirSync(agentDirectory).filter((name) => name === "agent.ts" || /^agent-.*\.ts$/.test(name)).sort().map((name) => readFileSync(join(agentDirectory, name), "utf8")).join("\n");
  assert.match(source, /role: "user", content: input\.message \}/, "the turn reminder is gone from the user's message");
  assert.doesNotMatch(source, /turnReminder/);
});

test("the first user message is the message and nothing else, byte for byte", async (t) => {

  const provider = new MockProvider({ answer: "Noted." });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-verbatim")) });

  const typed = "build the ring\n\n  keep   the inner spacing\tand the em dash — as typed.\nNo summary.";
  await chatTurn(address, typed);
  const first = splitTransient(provider.stepInputs[0]?.messages ?? []).persisted;
  assert.deepEqual(first.map((message) => message.role), ["user"], "the first turn carries the message alone");
  assert.equal(first[0]?.content, typed, "and carries it exactly as the panel sent it");
});

test("the briefing includes design-first guidance and required keywords", () => {
  const briefing = buildAgentBriefing(representativeSnapshot);

  assert.match(briefing, /Design first, then build, then animate/, "design-first guidance is present");
  assert.match(briefing, /subcomp is for something that is the same wherever it appears.*never to stand in for parts the request describes differently/, "a subcomp is for a reused element, not for parts the request describes differently");
  assert.match(briefing, /never assume 1920×1080/, "composition size guidance is present");
  assert.match(briefing, /ae_ask_user/, "ae_ask_user is mentioned");
  assert.match(briefing, /composition centre \(\[width\/2, height\/2\]\) with its anchor at \[0,0\]/, "shape layer positioning guidance is present");
  assert.match(briefing, /compositionId may be left out/, "compositionId guidance is present");

  assert.doesNotMatch(briefing, /before you inspect anything/, "old guidance about not inspecting is removed");
  assert.doesNotMatch(briefing, /never hold operations back until the design is complete/, "old guidance about holding back is removed");
});

test("the agent guide tells the model how to handle user assisted effects and controls", () => {
  const briefing = buildAgentBriefing(representativeSnapshot);

  assert.match(briefing, /marked userAssisted shows a dialog only the user can finish: say so in your reply/);
  assert.match(AGENT_GUIDES.effects, /User assisted effects and controls: a search or describe result marked userAssisted is one you may use/);
  assert.match(AGENT_GUIDES.effects, /After Effects will show a dialog the user must finish/);
  assert.match(AGENT_GUIDES.effects, /if they cancel the dialog, the step fails and the plan is undone/);
});
