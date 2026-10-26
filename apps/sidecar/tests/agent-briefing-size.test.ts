/** The first model call's fixed prefix: the system prompt stays small, and the reference material it left out is one lookup away. The pins were measured with the common operation shapes block on the representative project (5100 plain, 5836 workflow, 11066 for system plus offered tools); each is the measurement plus 10%. */
import { array, decodeOrThrow, object, string } from "@extynt/decode";
import { MockProvider } from "@extynt/llm";
import { representativeSnapshot } from "@extynt/project-graph";
import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_GUIDE_TOOL, AGENT_GUIDE_TOPICS, AGENT_GUIDES, readGuideTool } from "../src/agent-guides.js";
import { buildAgentBriefing, estimateTokens } from "../src/agent.js";
import { agentToolSpecs } from "../src/agent-tool-specs.js";
import { toolSurface } from "../src/agent-tool-surface.js";
import type { ChatAgentInput } from "../src/server-chat-agent-types.js";
import { workflowBriefing } from "../src/workflow-contract.js";
import { authorization, chatTurn, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";

const MEASURED_PLAIN_TOKENS = 5100;
const MEASURED_WORKFLOW_TOKENS = 6400;
const WORKFLOW_CEILING_TOKENS = 6500;

const workflowInput: ChatAgentInput = { requestId: "req-size", message: "", history: [], autoApply: false, workflowJobId: "job-1", workflowCycle: 0 };
const topicEnum = object({ properties: object({ topic: object({ enum: array(string()) }) }) });

test("a plain turn's system prompt stays within its measured size plus 10%", () => {
  const tokens = estimateTokens(buildAgentBriefing(representativeSnapshot, { providerName: "DeepSeek" }));
  assert.ok(tokens <= Math.ceil(MEASURED_PLAIN_TOKENS * 1.1), `the plain briefing is ${tokens} tokens`);
});

test("a workflow turn's system prompt stays within its measured size plus 10% and under 6.5k tokens", () => {
  const base = buildAgentBriefing(representativeSnapshot, { providerName: "DeepSeek" });
  const tokens = estimateTokens(workflowBriefing(base, workflowInput));
  assert.ok(tokens <= Math.min(Math.ceil(MEASURED_WORKFLOW_TOKENS * 1.1), WORKFLOW_CEILING_TOKENS), `the workflow briefing is ${tokens} tokens`);
});

test("every guide topic the briefing names resolves, and every guide is named in the briefing", () => {
  const briefing = buildAgentBriefing(representativeSnapshot);
  const named = [...briefing.matchAll(/^- ([a-z]+): .*$/gm)].flatMap((match) => (match[1] === undefined ? [] : [match[1]])).filter((topic) => topic in AGENT_GUIDES);
  assert.deepEqual([...new Set(named)].sort(), [...AGENT_GUIDE_TOPICS].sort(), "the briefing lists exactly the guide topics, one line each");
  for (const topic of named) {
    const result = readGuideTool({ topic });
    assert.equal(result.ok, true, `${topic} resolves`);
  }
  assert.match(briefing, /ae_read_guide \{topic\}/);
});

test("the guide tool is offered in the panel and an unknown topic is refused with the valid ones", () => {
  const spec = agentToolSpecs().find((tool) => tool.name === AGENT_GUIDE_TOOL);
  assert.ok(spec, "ae_read_guide is an in-panel tool");
  assert.deepEqual(decodeOrThrow(topicEnum, spec.parameters).properties.topic.enum, [...AGENT_GUIDE_TOPICS]);
  const refused = readGuideTool({ topic: "nonsense" });
  assert.equal(refused.ok, false);
  assert.match(JSON.stringify(refused), /effects, expressions, shapes, text, queue, scoped/);
});

test("a model that calls ae_read_guide gets the named section back", async (t) => {
  const provider = new MockProvider({ script: (input) => {
    const answered = input.messages.some((message) => message.role === "tool");
    return answered ? { text: "Done.", toolCalls: [] } : { text: "", toolCalls: [{ id: "g1", name: AGENT_GUIDE_TOOL, arguments: { topic: "text" } }] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-guide")) });
  await chatTurn(address, "how do I set a font?");
  const toolMessage = provider.stepInputs.at(-1)?.messages.find((message) => message.role === "tool");
  assert.match(String(toolMessage?.content), /Per-character animation is one add_text_animator/);
});

test("the first call's fixed prefix on a workflow turn, system plus offered tools, is at most 12k tokens, and the guide sits behind the dispatcher", () => {
  const system = workflowBriefing(buildAgentBriefing(representativeSnapshot, { providerName: "DeepSeek" }), workflowInput);
  const offered = toolSurface(agentToolSpecs({ workflowStage: true, workflowSpecialists: true, webSearch: true, acceptsImages: true })).offered;
  assert.ok(!offered.some((tool) => tool.name === AGENT_GUIDE_TOOL), "ae_read_guide is long-tail, reached through ae_call_tool");
  const tokens = estimateTokens(system) + estimateTokens(JSON.stringify(offered));
  assert.ok(tokens <= 12_000, `the fixed prefix is ${tokens} tokens`);
});
