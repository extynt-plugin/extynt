/** Tests that catalogue evidence is read from the database once and shared across scoped and full reads. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { EffectProbeEvidence, EffectProbeRow } from '../packages/capability-catalogue/dist/src/catalogue-model.js';
import { decodeOrThrow, number } from '../packages/decode/dist/src/index.js';
import { parseCataloguePage } from '../apps/sidecar/dist/src/catalogue-page.js';
import type { CatalogueEffectResult } from '../apps/sidecar/dist/src/catalogue-page.js';
import { collectorHarness, hostPage, effectResult, prop, requirePage, HOST_KEY } from './catalogue-support.ts';
import type { CollectorHarness, EffectResult } from './catalogue-support.ts';

function amountEffect(name: string, defaultValue: number): EffectResult {
  return effectResult(name, [prop(`${name}-0001`, { name: 'Amount', defaultValue })]);
}

function probedHarness(t: TestContext, names: readonly string[] = ['FX', 'FY']): CollectorHarness {
  const h = collectorHarness(t);
  h.land(names);
  const item = requirePage(h.collector.nextItem(true, 'p'));
  h.collector.complete(item.ticket, jsonOf(hostPage(item, { results: names.map(name => amountEffect(name, 25)) })));
  return h;
}

function parsed(effect: EffectResult): CatalogueEffectResult {
  const page = { schemaVersion: '0.1', ok: true, requestId: 'cache', host: { version: '26.2', build: '2' }, results: [effect], failures: [], remaining: [], elapsedMs: 1 };
  const outcome = parseCataloguePage(jsonOf(page), 'cache', [effect.matchName]);
  const result = outcome.kind === 'page' ? outcome.page.results[0] : undefined;
  if (!result) throw new Error('expected the page to parse');
  return result;
}

function write(h: CollectorHarness, runId: string, observedAt: number, effect: EffectResult): { written: string[] } {
  const outcome = h.graph.writeCatalogueProbe([{ hostKey: HOST_KEY, runId, observedAt, hostBuild: '2', version: 'v1', effect: parsed(effect) }]);
  if (!outcome) throw new Error('expected the probe write to report');
  return outcome;
}

function controlsOf(evidence: EffectProbeEvidence, name: string): EffectProbeRow[] | undefined {
  return evidence.effects[name]?.controls;
}

function amount(evidence: EffectProbeEvidence, name: string): number {
  return decodeOrThrow(number(), evidence.effects[name]?.controls?.[0]?.v);
}

function firstControl(evidence: EffectProbeEvidence, name: string): EffectProbeRow | undefined {
  return evidence.effects[name]?.controls?.[0];
}

test('evidence is read from the database once: the next read returns the same frozen control trees', t => {
  const h = probedHarness(t), first = h.graph.catalogueEvidence(HOST_KEY), second = h.graph.catalogueEvidence(HOST_KEY);
  assert.equal(controlsOf(first, 'FX'), controlsOf(second, 'FX'), 'the very same tree, not a re-expansion');
  assert.equal(Object.isFrozen(controlsOf(first, 'FX')), true);
  assert.equal(Object.isFrozen(firstControl(first, 'FX')), true);
  assert.equal(amount(first, 'FX'), 25);
  assert.equal(amount(first, 'FY'), 25);
});

test('a scoped read of some effects shares the trees of a full read, and a read of another host sees none', t => {
  const h = probedHarness(t), all = h.graph.catalogueEvidence(HOST_KEY), some = h.graph.catalogueEvidence(HOST_KEY, ['FY']);
  assert.deepEqual(Object.keys(some.effects), ['FY']);
  assert.equal(controlsOf(some, 'FY'), controlsOf(all, 'FY'));
  assert.deepEqual(h.graph.catalogueEvidence('After Effects:other:macOS').effects, {});
});

test('a new probe of an effect supersedes its tree at once, and the other effect keeps its own', t => {
  const h = probedHarness(t), before = h.graph.catalogueEvidence(HOST_KEY);
  assert.deepEqual(write(h, 'run-2', 2_000_000, amountEffect('FX', 99)).written, ['FX']);
  const after = h.graph.catalogueEvidence(HOST_KEY);
  assert.equal(amount(after, 'FX'), 99, 'the newest observation wins');
  assert.equal(amount(after, 'FY'), 25);
  assert.notEqual(controlsOf(after, 'FX'), controlsOf(before, 'FX'));
  assert.equal(amount(before, 'FX'), 25, 'what an earlier caller holds is not changed under it');
});

test('a source rewritten under the same run and time is read afresh, never from the tree built before', t => {
  const h = probedHarness(t);
  write(h, 'run-3', 3_000_000, amountEffect('FX', 1));
  assert.equal(amount(h.graph.catalogueEvidence(HOST_KEY), 'FX'), 1);
  write(h, 'run-3', 3_000_000, amountEffect('FX', 2));
  assert.equal(amount(h.graph.catalogueEvidence(HOST_KEY), 'FX'), 2);
});

test('a restart reads the same evidence from the file with an empty cache', t => {
  const h = probedHarness(t), before = h.graph.catalogueEvidence(HOST_KEY);
  h.restart();
  const after = h.graph.catalogueEvidence(HOST_KEY);
  assert.deepEqual(after, before); assert.notEqual(controlsOf(after, 'FX'), controlsOf(before, 'FX'));
});
