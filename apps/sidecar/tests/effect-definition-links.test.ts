// Tests linking project nodes to effect and parameter definitions, including duplicate descriptor suffixes and refused bindings.
import test from "node:test";
import assert from "node:assert/strict";
import { linkEffectDefinition, linkParameterDefinition, linkValueDefinition, queryParameterDefinitionFacts, writeEffectDefinitions, parameterDefinitionId } from "../src/effect-definition-store.js";
import { definitionFixture, definitionBundle, nativeSource, transaction, EFFECT, PARAMETER, firstParameter } from "./effect-definition-fixture.js";
import type { DatabaseSync } from "node:sqlite";

function addNodes(database: DatabaseSync): void {
  database.exec("INSERT INTO projects VALUES('p','/synthetic/P.aep','P','1','Linux'); INSERT INTO scopes VALUES(1,'p','properties','c','l',''),(2,'p','values','c','l','1/1/2'),(3,'p','properties','c','other-layer',''),(4,'p','values','c','other-layer','1/1/2')");
  const node = database.prepare("INSERT INTO nodes VALUES(?,?,?,?,?,?,?,?,?)");
  node.run(1, 1, "Effects/Synthetic Effect", "Effect", 1, "owner", 1, 4, 10); node.run(2, 1, "Effects/Synthetic Effect/Synthetic Amount", "Amount", 2, "owner", 1, 4, 10);
  node.run(3, 2, "value", "Amount", null, "owner", 1, 4, 10); node.run(4, 3, "Effects/Synthetic Effect/Synthetic Amount", "Amount", 2, "owner", 1, 4, 10);
  node.run(5, 4, "value-other", "Amount", null, "owner", 1, 4, 10);
  database.exec("INSERT INTO properties VALUES(1,'Effects/Synthetic Effect','Synthetic Effect',1,'NO_VALUE',NULL,NULL,'INDEXED_GROUP',NULL,NULL),(2,'Effects/Synthetic Effect/Synthetic Amount','Synthetic Amount',0,'OneD',0,100,'PROPERTY',1,1),(4,'Effects/Synthetic Effect/Synthetic Amount','Synthetic Amount',0,'OneD',0,100,'PROPERTY',1,1); INSERT INTO property_indices VALUES(1,0,1),(1,1,1),(2,0,1),(2,1,1),(2,2,2),(4,0,1),(4,1,1),(4,2,2); INSERT INTO value_observations VALUES(3,'observed-static','scalar',NULL,NULL),(5,'observed-static','scalar',NULL,NULL); INSERT INTO number_components VALUES(3,0,97),(5,0,31)");
}
test("exact relational native ancestry binds effect, parameter and current value without modifying defaults", t => {
  const { database } = definitionFixture(t); addNodes(database);
  linkEffectDefinition(database, { nodeId: 1, effectDefinitionId: EFFECT });
  linkParameterDefinition(database, { nodeId: 2, parameterDefinitionId: PARAMETER });
  linkValueDefinition(database, { nodeId: 3, propertyNodeId: 2 });
  const sql = "SELECT d.id,c.value FROM value_definition_links v JOIN parameter_definition_links p ON p.node_id=v.property_node_id JOIN parameter_definitions d ON d.id=p.parameter_definition_id JOIN number_components c ON c.node_id=v.node_id";
  assert.deepEqual({ ...database.prepare(sql).get() }, { id: PARAMETER, value: 97 });
  const documented = queryParameterDefinitionFacts(database, { parameterDefinitionId: PARAMETER }).rows.find(row => row.provenance.id === "docs-1");
  assert.deepEqual(documented?.facts.defaultValue, { state: "known", value: 12 });
});
test("matching names cannot bind across native ancestry or a different project-layer scope", t => {
  const { database } = definitionFixture(t); addNodes(database);
  assert.throws(() => linkParameterDefinition(database, { nodeId: 2, parameterDefinitionId: PARAMETER }), /BINDING_INVALID/);
  linkEffectDefinition(database, { nodeId: 1, effectDefinitionId: EFFECT });
  assert.throws(() => linkParameterDefinition(database, { nodeId: 4, parameterDefinitionId: PARAMETER }), /BINDING_INVALID/);
  assert.throws(() => linkEffectDefinition(database, { nodeId: 2, effectDefinitionId: EFFECT }), /BINDING_INVALID/);
  assert.throws(() => linkValueDefinition(database, { nodeId: 5, propertyNodeId: 2 }), /BINDING_INVALID/);
  database.exec("UPDATE property_indices SET ordinal=2 WHERE node_id=2 AND depth=1");
  assert.throws(() => linkParameterDefinition(database, { nodeId: 2, parameterDefinitionId: PARAMETER }), /BINDING_INVALID/);
});
test("typed new tables keep all source and numeric facts relational and enforce desired receipt references", t => {
  const { database } = definitionFixture(t), tables = database.prepare("SELECT name,sql FROM sqlite_master WHERE type='table'").all();
  assert.equal(tables.length, 36);
  for (const table of tables) {
    assert.equal(typeof table.name, "string"); assert.match(String(table.sql), /STRICT/);
    for (const column of database.prepare(`PRAGMA table_info(${String(table.name)})`).all()) {
      assert.ok(["INTEGER", "REAL", "TEXT"].includes(String(column.type)));
      assert.doesNotMatch(String(column.name), /json|jsx|blob|payload|script|expression_source/i);
    }
  }
  addNodes(database);
  database.exec("INSERT INTO effect_instances(id,project_id,composition_id,layer_id,effect_index,match_name,display_name,owner,epoch,revision,observed_at) VALUES(1,'p','c','l',1,'Synthetic Effect','Effect','owner',1,4,10); INSERT INTO control_instances(id,effect_instance_id,match_name,relative_path,index_path,display_name) VALUES(1,1,'Synthetic Amount','Synthetic Amount','1/2','Amount')");
  const insert = database.prepare("INSERT INTO desired_control_requests(plan_id,control_id,source_observation_id,source_owner,source_panel_instance_id,source_session_id,source_epoch,source_revision,requested_at,status,shape,ticket,read_set_digest,verified_observation_id,settled_at,receipt_reference) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  assert.throws(() => insert.run("unconfirmed", 1, "source", "owner", "panel", "session", 1, 4, 10, "verified", "scalar", "ticket", "digest", "proof", 11, null), /CHECK constraint/);
  insert.run("request", 1, "source", "owner", "panel", "session", 1, 4, 10, "prepared", "scalar", null, null, null, null, null);
  database.prepare("INSERT INTO desired_control_components VALUES(?,?,?)").run("request", 0, 55);
  assert.equal(database.prepare("SELECT value FROM number_components WHERE node_id=3").get()?.value, 97);
  assert.equal(database.prepare("SELECT value FROM parameter_default_components").get()?.value, 12);
  assert.equal(database.prepare("SELECT value FROM desired_control_components").get()?.value, 55);
  const verified = "UPDATE desired_control_requests SET status='verified',ticket='ticket',read_set_digest='digest',verified_observation_id='proof',receipt_reference='sha256:proof',settled_at=11,verified_epoch=?,verified_revision=? WHERE plan_id='request'";
  assert.throws(() => database.prepare(verified).run(null, null), /CHECK constraint/);
  assert.throws(() => database.prepare(verified).run(1, null), /CHECK constraint/);
  database.prepare(verified).run(1, 5);
  assert.deepEqual({ ...database.prepare("SELECT source_epoch,source_revision,verified_epoch,verified_revision FROM desired_control_requests").get() }, { source_epoch: 1, source_revision: 4, verified_epoch: 1, verified_revision: 5 });
});

test("duplicate descriptor suffixes keep distinct definitions and exact native index bindings", t => {
  const { database } = definitionFixture(t); addNodes(database);
  database.exec("UPDATE nodes SET native_id='Effects/Synthetic Effect/Synthetic Amount#2' WHERE id=2; UPDATE properties SET path='Effects/Synthetic Effect/Synthetic Amount#2' WHERE node_id=2");
  linkEffectDefinition(database, { nodeId: 1, effectDefinitionId: EFFECT });
  const duplicate = parameterDefinitionId(EFFECT, "Synthetic Amount#2"), bundle = definitionBundle();
  bundle.sources = [{ ...nativeSource(), id: "native-duplicate", instanceBinding: "synthetic-instance:1/control:2" }];
  bundle.plugins = []; bundle.effects = []; bundle.facts = [];
  bundle.parameters = [{ ...firstParameter(bundle), id: duplicate, path: "Synthetic Amount#2", provenanceId: "native-duplicate" }];
  transaction(database, () => writeEffectDefinitions(database, bundle));
  assert.throws(() => linkParameterDefinition(database, { nodeId: 2, parameterDefinitionId: PARAMETER }), /BINDING_INVALID/);
  linkParameterDefinition(database, { nodeId: 2, parameterDefinitionId: duplicate });
  assert.equal(database.prepare("SELECT parameter_definition_id FROM parameter_definition_links WHERE node_id=2").get()?.parameter_definition_id, duplicate);
});
