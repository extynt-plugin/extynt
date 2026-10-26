// Fixtures for the specialist handoff tests: a compiled scene design, a briefing bundle and a finished specialist session.

import type { CompiledSceneLayer } from "@extynt/mcp-server";
import { sceneManifest } from "@extynt/mcp-server";
import { present } from "./agent-test-support.js";
import type { SceneDesign } from "../src/workflow-design-compile.js";
import { WORKFLOW_OWNER, handoffContract, type WorkflowOrchestrationBundle, type WorkflowSpecialistActivity, type WorkflowSpecialistBrief, type WorkflowSpecialistRole, type WorkflowSpecialistSession } from "../src/workflow-orchestration.js";

export const handoffAt = "2026-10-01T12:00:00.000Z";
export const handoffRoles: WorkflowSpecialistRole[] = ["visual-scene", "motion", "execution"];

export function handoffDesign(): SceneDesign {
  const base: CompiledSceneLayer = {
    name: "Scene", anchor: [50, 25], bounds: [0, 0, 100, 50], opacity: 75,
    shapes: [{
      name: "Compound", opacity: 0,
      paths: [{ vertices: [[0, 0], [2_000_000, 50]], inTangents: [[0, 0], [-10, 0]], outTangents: [[10, 0], [0, 0]], closed: false }],
      fill: { color: [0, 0.5, 1], opacity: 0, rule: "evenodd" },
      stroke: { color: [1, 0, 0.5], width: 2, opacity: 80, cap: "round", join: "bevel", miterLimit: 4 },
    }, {
      name: "Closed", paths: [{ vertices: [[0, 0], [10, 0], [0, 10]], closed: true }],
      fill: { color: [1, 1, 1], rule: "nonzero" }, stroke: { color: [0, 0, 0], width: 1, cap: "butt", join: "miter" },
    }, { name: "Outline", paths: [], stroke: { color: [1, 0, 0], width: 3, cap: "square", join: "round" } }],
    ramp: { kind: "linear", start: [0, 0], end: [100, 50], startColor: [0, 0, 0], endColor: [1, 1, 1] },
    clipPath: { paths: [{ vertices: [[0, 0], [5, 5]], closed: false }] },
    effect: { kind: "gaussian-blur", blur: { stdDeviation: 2 } }, blendMode: "multiply",
  };
  const layers: CompiledSceneLayer[] = [base,
    { ...base, name: "Shadow", ramp: { ...present(base.ramp, "base ramp"), kind: "radial" }, effect: { kind: "drop-shadow", shadow: { dx: 1, dy: -2, stdDeviation: 3, floodColor: [0, 0, 0], floodOpacity: 0.5 } } },
    { ...base, name: "Glow", effect: { kind: "glow", glow: { stdDeviation: 4 } } },
    { name: "Plain", anchor: [0, 0], bounds: [0, 0, 1, 1], opacity: 100, shapes: [] },
  ];
  return { svg: '<svg viewBox="0 0 100 50"><g id="Scene"><rect width="100" height="50"/></g></svg>', scene: { width: 100, height: 50, layers, warnings: ["Original compiler warning"] }, compositionId: null, targetCompositionPlaceholder: "__new__:scene", compiledAt: handoffAt };
}

export function handoffBrief(role: WorkflowSpecialistRole): WorkflowSpecialistBrief {
  return { role, objective: `Keep ${role} advice`, requirements: [" Preserve exact whitespace \n and drawing "], deliverables: ["Layer names"], constraints: [], verification: ["Frame 0"], ...(role === "visual-scene" ? { scene: sceneManifest(handoffDesign().scene) } : {}) };
}

export function handoffActivity(role: WorkflowSpecialistRole): WorkflowSpecialistActivity {
  return { role, status: "completed", turn: 2, text: "Completed handoff", reasoning: "Original reason", updatedAt: handoffAt };
}

export function handoffSession(role: WorkflowSpecialistRole): WorkflowSpecialistSession {
  return {
    role, turns: 2, messages: [{ role: "user", content: "Original prompt" }, { role: "assistant", content: "Drawing and advice" }, { role: "tool", content: "Historical reply", toolCallId: "call-1", name: "advisory-history" }],
    activity: handoffActivity(role), brief: handoffBrief(role), error: "Original error", generation: 0, ownerSeenTurn: 0, ownerWokenTurn: 2,
    ...(role === "visual-scene" ? { design: handoffDesign() } : {}),
  };
}

export function handoffBundle(mode: WorkflowOrchestrationBundle["mode"] = "delegated"): WorkflowOrchestrationBundle {
  const specialists = handoffRoles.map(handoffBrief);
  return { owner: WORKFLOW_OWNER, mode, specialists, unavailable: [{ role: "execution", reason: "No provider" }], handoff: handoffContract(specialists, "Animate original scene"), activity: handoffRoles.map(handoffActivity) };
}

export function handoffPayload() {
  return { version: 1, orchestrations: { job: handoffBundle() }, sessions: { job: Object.fromEntries(handoffRoles.map((role) => [role, handoffSession(role)])) } };
}
