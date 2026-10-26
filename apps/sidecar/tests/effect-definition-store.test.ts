// Tests the definition store: writes, provenance rules, refused rewrites and injection-safe names against a synthetic graph file.
import test from "node:test";
import assert from "node:assert/strict";
import type { DefinitionProvenance, EffectDefinitionBundle, ParameterDefinitionFacts } from "@extynt/project-graph";
import { getDefinitionProvenance, queryPluginDefinitions, queryEffectDefinitions, queryParameterDefinitions, queryParameterDefinitionFacts, writeEffectDefinitions, effectDefinitionId, parameterDefinitionId } from "../src/effect-definition-store.js";
import { definitionBundle, definitionFixture, documentedSource, EFFECT, HOST, nativeSource, PARAMETER, transaction, unknownFacts, firstEffect, firstParameter, firstPlugin } from "./effect-definition-fixture.js";

const empty = (): EffectDefinitionBundle => ({ sources: [], plugins: [], effects: [], parameters: [], facts: [] });
test("definition queries preserve provenance-separated native facts, documented meaning and explicit unknowns", t => {
  const { database } = definitionFixture(t), effects = queryEffectDefinitions(database, { hostKey: HOST });
  assert.equal(effects.writeAuthorizing, false); assert.equal(effects.rows[0]?.pluginId, null);
  const view = queryParameterDefinitions(database, { effectDefinitionId: EFFECT }).rows[0];
  assert.ok(view); assert.equal(view.parameter.id, PARAMETER); assert.equal(view.facts.writeAuthorizing, false);
  const native = view.facts.rows.find(row => row.provenance.kind === "native-observation");
  const documented = view.facts.rows.find(row => row.provenance.kind === "authored-documentation");
  assert.ok(native); assert.ok(documented);
  assert.deepEqual(native.facts.defaultValue, { state: "unknown" }); assert.equal(native.facts.units, null);
  assert.equal(native.facts.meaning, null); assert.equal(native.provenance.instanceBinding, "synthetic-instance:1/control:1");
  assert.deepEqual(documented.facts.defaultValue, { state: "known", value: 12 });
  assert.equal(documented.facts.units, "synthetic-unit"); assert.equal(documented.facts.meaning, "Synthetic fixture semantic meaning");
});
test("native current metadata cannot supply defaults or undocumented semantic meaning", t => {
  const { database } = definitionFixture(t), base = unknownFacts();
  const invalid: ParameterDefinitionFacts[] = [{ ...base, defaultValue: { state: "known", value: 99 } }, { ...base, meaning: "Guess from a name" }, { ...base, description: "Guess from a number" }];
  for (const facts of invalid) {
    assert.throws(() => transaction(database, () => writeEffectDefinitions(database, { ...empty(), facts: [facts] })), /GRAPH_DEFINITION/);
  }
  assert.deepEqual(queryParameterDefinitionFacts(database, { parameterDefinitionId: PARAMETER }).rows.find(row => row.provenance.id === "native-1")?.facts.defaultValue, { state: "unknown" });
});
test("known native numeric defaults require factory-default context and retain source binding", t => {
  const { database } = definitionFixture(t), source: DefinitionProvenance = { ...nativeSource(), id: "factory", observationContext: "factory-default" };
  transaction(database, () => writeEffectDefinitions(database, { ...empty(), sources: [source], facts: [{ ...unknownFacts("factory"), defaultValue: { state: "known", value: 3 } }] }));
  const factory = queryParameterDefinitionFacts(database, { parameterDefinitionId: PARAMETER }).rows.find(row => row.provenance.id === "factory");
  assert.deepEqual(factory?.facts.defaultValue, { state: "known", value: 3 }); assert.equal(factory?.provenance.instanceBinding, nativeSource().instanceBinding);
});
test("definition source identities are immutable and a failing fact rolls the full bundle back", t => {
  const { database } = definitionFixture(t), before = database.prepare("SELECT * FROM definition_sources ORDER BY id").all();
  assert.throws(() => transaction(database, () => writeEffectDefinitions(database, { ...empty(), sources: [{ ...documentedSource(), title: "Changed source identity" }] })), /SOURCE_CONFLICT/);
  assert.throws(() => transaction(database, () => writeEffectDefinitions(database, { ...empty(), sources: [{ ...documentedSource(), id: "new-doc" }], facts: [{ ...unknownFacts("new-doc"), maximum: -1 }] })), /GRAPH_DEFINITION_INVALID/);
  assert.deepEqual(database.prepare("SELECT * FROM definition_sources ORDER BY id").all(), before);
});
test("metadata and native identifiers remain bound SQL values and stable identities survive refresh", t => {
  const { database } = definitionFixture(t), bundle = definitionBundle();
  firstEffect(bundle).displayName = "Bound'; DROP TABLE effect_definitions;--";
  firstParameter(bundle).displayName = "Parameter renamed";
  transaction(database, () => writeEffectDefinitions(database, bundle));
  assert.equal(queryEffectDefinitions(database, { hostKey: HOST }).rows[0]?.id, EFFECT);
  assert.equal(queryParameterDefinitions(database, { effectDefinitionId: EFFECT }).rows[0]?.parameter.id, PARAMETER);
  assert.equal(database.prepare("SELECT count(*) AS count FROM effect_definitions").get()?.count, 1);
});
test("definition and fact keyset pages remain bounded without silently dropping source evidence", t => {
  const { database } = definitionFixture(t), bundle = empty();
  for (let index = 0; index < 30; index += 1) {
    const matchName = `Synthetic ${index}`, id = effectDefinitionId(HOST, matchName, null);
    bundle.effects.push({ ...firstEffect(definitionBundle()), id, matchName });
    bundle.sources.push({ ...documentedSource(), id: `docs-${index + 2}` });
    bundle.facts.push({ ...unknownFacts(`docs-${index + 2}`), units: `unit-${index}` });
  }
  transaction(database, () => writeEffectDefinitions(database, bundle));
  const first = queryEffectDefinitions(database, { hostKey: HOST, limit: 1000 }); assert.equal(first.rows.length, 25);
  const second = queryEffectDefinitions(database, { hostKey: HOST, cursor: first.nextCursor ?? "" });
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 31); assert.equal(second.nextCursor, null);
  const facts = []; let cursor: string | undefined;
  do { const result = queryParameterDefinitionFacts(database, { parameterDefinitionId: PARAMETER, ...(cursor === undefined ? {} : { cursor }), limit: 1000 }); assert.ok(result.rows.length <= 8); facts.push(...result.rows); cursor = result.nextCursor ?? undefined; } while (cursor !== undefined);
  assert.equal(facts.length, 32); assert.equal(new Set(facts.map(row => row.provenance.id)).size, 32);
  const plan = database.prepare("EXPLAIN QUERY PLAN SELECT * FROM parameter_definitions WHERE effect_definition_id=? AND id>? ORDER BY id LIMIT ?").all(EFFECT, "", 26).map(row => row.detail).join(" ");
  assert.match(plan, /parameter_definition_keyset/); assert.doesNotMatch(plan, /TEMP B-TREE/);
});
test("unsupported defaults and forged native identity fail atomically", t => {
  const { database } = definitionFixture(t), bundle = definitionBundle();
  firstParameter(bundle).id = parameterDefinitionId(EFFECT, "different-native-path");
  assert.throws(() => transaction(database, () => writeEffectDefinitions(database, bundle)), /IDENTITY_INVALID/);
  assert.throws(() => transaction(database, () => writeEffectDefinitions(database, { ...empty(), facts: [{ ...unknownFacts("docs-1"), defaultValue: { state: "known", value: [1, Number.NaN] } }] })), /GRAPH_DEFINITION_INVALID/);
});

test("observed empty native unit labels stay distinct from unknown and documented semantic units", t => {
  const { database } = definitionFixture(t);
  transaction(database, () => writeEffectDefinitions(database, { ...empty(), facts: [{ ...unknownFacts(), units: "" }] }));
  const facts = queryParameterDefinitionFacts(database, { parameterDefinitionId: PARAMETER }).rows;
  assert.equal(facts.find(row => row.provenance.id === "native-1")?.facts.units, "");
  assert.equal(facts.find(row => row.provenance.id === "docs-1")?.facts.units, "synthetic-unit");
  assert.equal(database.prepare("SELECT units FROM parameter_definition_facts WHERE provenance_id=?").get("native-1")?.units, "");
});

test("documented plugin identity and unknown vendor fields remain connected through provenance", t => {
  const { database } = definitionFixture(t), bundle = definitionBundle();
  bundle.plugins.push({ id: "synthetic-plugin", nativeId: "synthetic-native-plugin", displayName: "Synthetic plugin", vendor: null, version: null, provenanceId: "docs-1" });
  firstEffect(bundle).pluginId = "synthetic-plugin";
  transaction(database, () => writeEffectDefinitions(database, bundle));
  const plugin = queryPluginDefinitions(database, { nativeId: "synthetic-native-plugin", limit: 1000 });
  assert.equal(plugin.writeAuthorizing, false); assert.equal(plugin.rows[0]?.vendor, null);
  assert.equal(queryEffectDefinitions(database, { hostKey: HOST }).rows[0]?.pluginId, plugin.rows[0]?.id);
  assert.equal(getDefinitionProvenance(database, "docs-1")?.sourceUrl, documentedSource().sourceUrl);
  firstPlugin(bundle).nativeId = "different-native-plugin";
  assert.throws(() => transaction(database, () => writeEffectDefinitions(database, bundle)), /IDENTITY_INVALID/);
});
test("native facts for a different host and unsupported default shapes cannot change definitions", t => {
  const { database } = definitionFixture(t), foreign = { ...nativeSource(), id: "foreign-native", hostKey: "After Effects:2:Linux" };
  assert.throws(() => transaction(database, () => writeEffectDefinitions(database, { ...empty(), sources: [foreign], facts: [unknownFacts("foreign-native")] })), /PROVENANCE_INVALID/);
  const wrongShapes: ParameterDefinitionFacts[] = [
    { ...unknownFacts("docs-1"), valueType: "TwoD", defaultValue: { state: "known", value: 1 } },
    { ...unknownFacts("docs-1"), valueType: "TEXT_DOCUMENT", defaultValue: { state: "known", value: 1 } },
    { ...unknownFacts("docs-1"), defaultValue: { state: "known", value: [1] } },
  ];
  for (const facts of wrongShapes) assert.throws(() => transaction(database, () => writeEffectDefinitions(database, { ...empty(), facts: [facts] })), /GRAPH_DEFINITION_INVALID/);
  assert.equal(getDefinitionProvenance(database, "foreign-native"), undefined);
});
test("verified documented vector defaults normalize into ordered numeric components", t => {
  const { database } = definitionFixture(t);
  transaction(database, () => writeEffectDefinitions(database, { ...empty(), facts: [{ ...unknownFacts("docs-1"), valueType: "COLOR", defaultValue: { state: "known", value: [0.1, 0.2, 0.3, 1] } }] }));
  const facts = queryParameterDefinitionFacts(database, { parameterDefinitionId: PARAMETER }).rows.find(row => row.provenance.id === "docs-1");
  assert.deepEqual(facts?.facts.defaultValue, { state: "known", value: [0.1, 0.2, 0.3, 1] });
  assert.deepEqual(database.prepare("SELECT component FROM parameter_default_components ORDER BY component").all().map(row => row.component), [0, 1, 2, 3]);
});

test("filtered definition keyset plans select native identity indexes without a temporary sort", t => {
  const { database } = definitionFixture(t);
  const effectSql = "EXPLAIN QUERY PLAN SELECT * FROM effect_definitions WHERE host_key=? AND match_name=? AND id>? ORDER BY id LIMIT ?";
  const effectPlan = database.prepare(effectSql).all(HOST, "Synthetic Effect", "", 26).map(row => row.detail).join(" ");
  assert.match(effectPlan, /effect_definition_match_keyset/); assert.doesNotMatch(effectPlan, /TEMP B-TREE/);
  const pluginSql = "EXPLAIN QUERY PLAN SELECT * FROM plugin_definitions WHERE native_id=? AND id>? ORDER BY id LIMIT ?";
  const pluginPlan = database.prepare(pluginSql).all("native", "", 26).map(row => row.detail).join(" ");
  assert.match(pluginPlan, /plugin_definition_native_keyset/); assert.doesNotMatch(pluginPlan, /TEMP B-TREE/);
});

test("native match names with escaped path delimiters retain raw match-name identity", t => {
  const { database } = definitionFixture(t), bundle = definitionBundle(), matchName = "Synthetic/Amount#%";
  const path = "Synthetic%2FAmount%23%25", id = parameterDefinitionId(EFFECT, path);
  bundle.parameters = [{ ...firstParameter(bundle), id, path, matchName }]; bundle.facts = [];
  transaction(database, () => writeEffectDefinitions(database, bundle));
  const stored = queryParameterDefinitions(database, { effectDefinitionId: EFFECT }).rows.find(row => row.parameter.id === id);
  assert.equal(stored?.parameter.matchName, matchName); assert.equal(stored?.parameter.path, path);
});

test("parameter and plugin origins cannot bind native metadata from an incompatible host", t => {
  const { database } = definitionFixture(t), bundle = definitionBundle();
  bundle.sources = [{ ...nativeSource(), id: "foreign-origin", hostKey: "After Effects:2:Linux" }];
  bundle.effects = []; bundle.facts = []; firstParameter(bundle).provenanceId = "foreign-origin";
  assert.throws(() => transaction(database, () => writeEffectDefinitions(database, bundle)), /PROVENANCE_INVALID/);
  const pluginBundle = definitionBundle(); pluginBundle.sources = bundle.sources;
  pluginBundle.plugins = [{ id: "foreign-plugin", nativeId: "plugin", displayName: "Plugin", vendor: null, version: null, provenanceId: "foreign-origin" }];
  firstEffect(pluginBundle).pluginId = "foreign-plugin"; pluginBundle.parameters = []; pluginBundle.facts = [];
  assert.throws(() => transaction(database, () => writeEffectDefinitions(database, pluginBundle)), /PROVENANCE_INVALID/);
});

test("literal native hash suffixes remain escaped while observed sibling occurrences remain distinct", t => {
  const { database } = definitionFixture(t), bundle = definitionBundle(), matchName = "Synthetic Amount#2";
  const firstPath = "Synthetic Amount%232", secondPath = "Synthetic Amount%232#2";
  const base = firstParameter(bundle);
  bundle.parameters = [firstPath, secondPath].map(path => ({ ...base, id: parameterDefinitionId(EFFECT, path), path, matchName })); bundle.facts = [];
  transaction(database, () => writeEffectDefinitions(database, bundle));
  const stored = queryParameterDefinitions(database, { effectDefinitionId: EFFECT }).rows.filter(row => row.parameter.matchName === matchName);
  assert.equal(stored.length, 2); assert.notEqual(stored[0]?.parameter.id, stored[1]?.parameter.id);
  assert.deepEqual(stored.map(row => row.parameter.path).sort(), [firstPath, secondPath]);
  bundle.parameters = [{ ...base, id: parameterDefinitionId(EFFECT, "Synthetic Amount#2"), path: "Synthetic Amount#2", matchName }];
  assert.throws(() => transaction(database, () => writeEffectDefinitions(database, bundle)), /IDENTITY_INVALID/);
});
test("malformed duplicate suffixes cannot weaken native match-name identity", t => {
  const { database } = definitionFixture(t);
  for (const path of ["Synthetic Amount#0", "Synthetic Amount#1", "Synthetic Amount#02", "Synthetic Amount#-2"]) {
    const bundle = definitionBundle(); bundle.facts = [];
    bundle.parameters[0] = { ...firstParameter(bundle), id: parameterDefinitionId(EFFECT, path), path };
    assert.throws(() => transaction(database, () => writeEffectDefinitions(database, bundle)), /IDENTITY_INVALID/);
  }
});
