// Tests the graph schema upgrade: v1 and v2 files gain typed definitions while every legacy row survives, and unsafe files stay untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { TestContext } from "node:test";
import { openGraphFile } from "../src/graph-file.js";
import { GRAPH_SCHEMA_VERSION } from "../src/graph-schema.js";
import { GraphStore } from "../src/graph-store.js";
import { definitionBundle, transaction, EFFECT } from "./effect-definition-fixture.js";
import { writeEffectDefinitions, queryParameterDefinitions } from "../src/effect-definition-store.js";

const LEGACY_TABLES = ["projects", "scopes", "nodes", "items", "layers", "properties", "property_indices", "value_observations", "number_components", "installed_effects", "presets"];
function fixture(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "extynt-definition-migration-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "legacy.extynt");
}
function seed(path: string, version: number): DatabaseSync {
  writeFileSync(path, "", { mode: 0o600 });
  const database = new DatabaseSync(path);
  database.exec(readFileSync(new URL("../../../../tests/fixtures/graph-schema-v1.sql", import.meta.url), "utf8"));
  if (version === 2) database.exec("DROP INDEX nodes_scope_order; CREATE INDEX nodes_scope_id ON nodes(scope_id,id); PRAGMA user_version=2");
  database.exec("INSERT INTO projects VALUES('p','/synthetic/P.aep','P.aep','1','Linux'); INSERT INTO scopes VALUES(1,'p','properties','c','l',''); INSERT INTO nodes VALUES(41,1,'Synthetic Amount','Amount',NULL,'prior-owner',1,4,10); INSERT INTO properties VALUES(41,'Synthetic Amount','Synthetic Amount',0,'OneD',0,100,'PROPERTY',1,1); INSERT INTO property_indices VALUES(41,0,1); INSERT INTO installed_effects VALUES('synthetic-host:1:Linux','Synthetic Effect','Effect','Synthetic','1',1,10,'partial'); INSERT INTO presets VALUES('host','preset','Preset','Synthetic','unknown','fingerprint','2026-10-01T00:00:00.000Z',0)");
  return database;
}
function retained(database: DatabaseSync): Record<string, ReturnType<StatementSync["all"]>> {
  return Object.fromEntries(LEGACY_TABLES.map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
for (const version of [1, 2]) {
  test(`v${version} upgrade adds typed definitions and preserves every legacy row and node key`, t => {
    const path = fixture(t), old = seed(path, version), before = retained(old); old.close();
    const migrated = openGraphFile(path);
    try {
      assert.equal(migrated.prepare("PRAGMA user_version").get()?.user_version, GRAPH_SCHEMA_VERSION);
      assert.deepEqual(retained(migrated), before);
      assert.deepEqual(migrated.prepare("PRAGMA index_info(nodes_scope_id)").all().map(row => row.name), ["scope_id", "id"]);
      assert.equal(migrated.prepare("SELECT count(*) AS count FROM effect_definitions").get()?.count, 0);
      transaction(migrated, () => writeEffectDefinitions(migrated, definitionBundle()));
      assert.deepEqual(retained(migrated), before); assert.equal(migrated.prepare("PRAGMA foreign_key_check").all().length, 0);
      if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
    } finally { migrated.close(); }
  });
  test(`v${version} failed additive migration rolls back all schema changes and preserves bytes`, t => {
    const path = fixture(t), old = seed(path, version); old.exec("CREATE TABLE control_instances(preserved TEXT) STRICT");
    const before = retained(old), schema = old.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(); old.close();
    const bytes = readFileSync(path); assert.throws(() => openGraphFile(path));
    const check = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(check.prepare("PRAGMA user_version").get()?.user_version, version);
      assert.deepEqual(retained(check), before); assert.deepEqual(check.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(), schema);
    } finally { check.close(); }
    assert.deepEqual(readFileSync(path), bytes);
  });
}
test("future, foreign, corrupt and publicly readable definition databases remain untouched", t => {
  for (const kind of ["future", "foreign", "corrupt", ...(process.platform === "win32" ? [] : ["public"])]) {
    const path = fixture(t);
    if (kind === "corrupt") writeFileSync(path, "preserve corruption", { mode: 0o600 });
    else {
      const old = seed(path, 2);
      if (kind === "future") old.exec("PRAGMA user_version=99");
      if (kind === "foreign") old.exec("PRAGMA application_id=0");
      old.close();
      if (kind === "public") chmodSync(path, 0o644);
    }
    const bytes = readFileSync(path); assert.throws(() => openGraphFile(path)); assert.deepEqual(readFileSync(path), bytes);
  }
});

test("reopening v3 retains definitions and semantic provenance without current observation authority", t => {
  const path = fixture(t), original = openGraphFile(path);
  transaction(original, () => writeEffectDefinitions(original, definitionBundle())); original.close();
  const reopened = openGraphFile(path), store = new GraphStore(path);
  try {
    const definitions = queryParameterDefinitions(reopened, { effectDefinitionId: EFFECT });
    assert.equal(definitions.writeAuthorizing, false); assert.equal(definitions.rows.length, 1);
    const facts = definitions.rows[0]?.facts.rows;
    assert.deepEqual(facts?.find(row => row.provenance.id === "docs-1")?.facts.defaultValue, { state: "known", value: 12 });
    assert.deepEqual(facts?.find(row => row.provenance.id === "native-1")?.facts.defaultValue, { state: "unknown" });
    assert.equal(store.query({ target: { kind: "index" } }, 20).state, "unknown");
    assert.equal(store.queryRelational({ kind: "controls", compositionId: "c", layerId: "l" }, 20).state, "unknown");
  } finally { reopened.close(); store.close(); }
});
