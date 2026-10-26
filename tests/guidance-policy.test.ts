/** Tests the agent guidance policy: scoped reads, evidence kinds, agency and undo advice. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { representativeSnapshot } from '../packages/project-graph/dist/src/index.js';
import type { ProjectSnapshot } from '../packages/project-graph/dist/src/index.js';
import { AGENT_GUIDES } from '../apps/sidecar/dist/src/agent-guides.js';
import { buildAgentBriefing, buildAgentBriefingSegments } from '../apps/sidecar/dist/src/agent-briefing.js';

function scopedSnapshot(): ProjectSnapshot {
  const snapshot = structuredClone(representativeSnapshot);
  const comp = snapshot.compositions.find(c => c.id === snapshot.activeCompositionId) ?? snapshot.compositions[0];
  if (comp === undefined) throw new Error('the representative snapshot has no composition');
  snapshot.activeCompositionId = comp.id;
  snapshot.compositions = [comp];
  snapshot.coverage = { kind: 'composition-metadata', compositionId: comp.id, properties: 'unknown', otherCompositions: 'unknown', otherLayers: 'unknown', observedLayerIds: comp.layers.map(l => l.id) };
  for (const layer of comp.layers) layer.properties = [];
  return snapshot;
}

test('scoped guidance distinguishes unknown property counts and bounded discovery from legacy inspection', () => {
  const text = buildAgentBriefing(scopedSnapshot());
  assert.match(text, /unobserved layer visibility, effect, keyframe and expression counts are unknown/);
  assert.doesNotMatch(text, /effects on 0 layers|keyframes on 0 properties|no tool here can see past the probe/);
  assert.match(text, /Legacy ae_inspect_layer\/ae_inspect_composition inspect only their available snapshot coverage/);
  assert.match(text, /sidecar reconciles freshness deterministically/);
  assert.match(text, /stale or unknown evidence is not absence and cannot authorize a write/);
  assert.doesNotMatch(text, /call ae_refresh_snapshot first/);
});

test('stable policy separates structural and visual evidence, preserves agency and refuses scoped Undo promises', () => {
  const segments = buildAgentBriefingSegments(scopedSnapshot());
  const stable = segments[0]?.text ?? '';
  assert.match(AGENT_GUIDES.scoped, /Scoped rename, Gaussian creation and blur receipts do not support panel\/API Undo/);
  assert.match(AGENT_GUIDES.scoped, /native AE Undo is available/);
  assert.match(stable, /do not capture after every tiny edit/);
  assert.match(stable, /screenshot guidance never expands approved write targets/);
  assert.match(stable, /agent may change the suggested workflow/);
  assert.match(stable, /None implies complete expression\/dependency closure/);
  assert.match(stable, /unresolved native call requires reconciliation\/recovery, never an automatic write retry/);
  assert.match(AGENT_GUIDES.scoped, /Choose every value from the user intent, or ask/, 'the blur creation detail is read on demand from the scoped guide');
  assert.match(stable, /ae_read_guide \{scoped\}/);
});
