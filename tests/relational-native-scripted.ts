// A scripted in-panel agent that queries one typed control and prepares a parameter change through the sidecar's own tool route.
import assert from 'node:assert/strict';
import { fieldOf, readJson, recordsAt, textAt } from '../apps/panel/dist/tests/json-narrow.js';
import { jsonFieldsOf } from '../packages/mcp-server/dist/src/index.js';
import { runAgent } from '../apps/sidecar/dist/src/agent.js';
import type { AgentRunResult, ToolResult } from '../apps/sidecar/dist/src/agent-types.js';
import { decodeOrThrow, jsonObject } from '../packages/decode/dist/src/index.js';
import type { JsonValue } from '../packages/decode/dist/src/index.js';
import type { AgentStepInput, AgentStepResult } from '../packages/llm/dist/src/types.js';
import { MockProvider } from '../packages/llm/dist/src/mock.js';
import type { Proposal } from './relational-native-agent.ts';
import type { Rig } from './relational-native-rig.ts';

/** What the scripted agent did: the run, the provider that answered it, the plan it prepared and every tool answer it saw. */
export interface ScriptedProposal {
  readonly result: AgentRunResult;
  readonly provider: MockProvider;
  readonly proposal: Proposal;
  readonly toolReplies: JsonValue[];
}

function queryCall(rig: Rig): AgentStepResult {
  const query = { kind: 'controls', compositionId: rig.host.comp.id, layerId: rig.host.title.id, controlMatchName: 'ADBE Gaussian Blur 2-0001', limit: 1 };
  return { text: '', toolCalls: [{ id: 'query', name: 'ae_call_tool', arguments: { name: 'ae_query_relational_graph', arguments: { query } } }] };
}

function prepareCall(input: AgentStepInput): AgentStepResult {
  const last = input.messages.at(-1);
  if (last === undefined) throw new Error('the agent has no messages');
  const control = recordsAt(readJson(last.content.split('\n')[0] ?? ''), 'data', 'rows')[0];
  if (control === undefined) throw new Error('the query answered no control row');
  const value = { kind: 'number', value: 8 };
  const prepared = jsonFieldsOf({ controlInstanceId: control.controlInstanceId, observationId: control.observationId, value });
  return { text: '', toolCalls: [{ id: 'prepare', name: 'ae_call_tool', arguments: { name: 'ae_prepare_parameter_change', arguments: prepared } }] };
}

function scriptedReply(rig: Rig, input: AgentStepInput): AgentStepResult {
  const catalogue = input.tools.find(tool => tool.name === 'ae_tool_schema')?.description ?? '';
  assert.ok(input.tools.some(tool => tool.name === 'ae_call_tool'));
  assert.match(catalogue, /\bae_query_relational_graph\b/);
  assert.match(catalogue, /\bae_prepare_parameter_change\b/);
  const calls = input.messages.filter(message => message.role === 'tool').length;
  if (calls === 0) return queryCall(rig);
  if (calls === 1) return prepareCall(input);
  return { text: 'Prepared a request for approval.', toolCalls: [] };
}

function toolResultOf(body: JsonValue): ToolResult {
  return { ...decodeOrThrow(jsonObject, body), ok: fieldOf(body, 'ok') === true };
}

export async function scriptedParameterProposal(rig: Rig): Promise<ScriptedProposal> {
  const toolReplies: JsonValue[] = [];
  const proposals: Proposal[] = [];
  const provider = new MockProvider({ script: input => scriptedReply(rig, input) });
  const result = await runAgent(provider, {
    requestId: 'relational-scripted-agent', message: 'Prepare Blurriness 8 for approval', history: [], briefing: 'Use typed bounded tools and report only the observed outcome.', maxSteps: 4,
    async callTool(name, args) {
      const response = await rig.tool(name, decodeOrThrow(jsonObject, args));
      toolReplies.push(response.body);
      if (name === 'ae_prepare_parameter_change') proposals.push({ planId: textAt(response.body, 'data', 'planId') });
      return toolResultOf(response.body);
    },
  });
  assert.equal(result.failure, undefined, JSON.stringify(result));
  assert.deepEqual(result.tools.map(tool => [tool.name, tool.ok]), [['ae_query_relational_graph', true], ['ae_prepare_parameter_change', true]]);
  assert.equal(provider.calls, 3);
  const [proposal] = proposals;
  assert.ok(proposal?.planId);
  return { result, provider, proposal, toolReplies };
}
