/** aeCollectionStamp: the plugin's injected __extyntProjectEpoch wins when valid; otherwise the file's own counter stands. */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { loadHostFiles } from "./host-sources.js";
import { type HostContext, loadHostContext } from "./host-vm-context.js";
import { type Found, numberAt } from "./json-narrow.js";

type Project = { revision: number; file: { fsName: string } | null };

function setup(project: Project): { host: HostContext; app: { project: Project } } {
  const app = { project };
  const host = loadHostContext({ app, CompItem: class {} });
  loadHostFiles(host.context, "collection.jsx");
  return { host, app };
}

function stamp(host: HostContext): { epoch: number; revision: number } {
  const reading = host.call("aeCollectionStamp()");
  return { epoch: numberAt(reading, "epoch"), revision: numberAt(reading, "revision") };
}

function inject(host: HostContext, literal: string): void {
  vm.runInContext(`__extyntProjectEpoch = ${literal}`, host.context);
}

function remove(host: HostContext): void {
  vm.runInContext("delete globalThis.__extyntProjectEpoch", host.context);
}

function sessions(host: HostContext): Found {
  return host.call("[aeCollectionSession, aeCollectionDetailSession, aeCollectionValueSession]");
}

function fill(host: HostContext): void {
  vm.runInContext("aeCollectionSession = { a: 1 }; aeCollectionDetailSession = { b: 2 }; aeCollectionValueSession = { c: 3 };", host.context);
}

test("an injected non-negative integer epoch is the stamp's epoch, zero included", () => {
  const { host } = setup({ revision: 7, file: null });
  inject(host, "3");
  assert.deepEqual(stamp(host), { epoch: 3, revision: 7 });
  inject(host, "0");
  assert.deepEqual(stamp(host), { epoch: 0, revision: 7 });
  inject(host, "3");
  assert.equal(stamp(host).epoch, 3, "a project object that did not change leaves the injected value untouched");
});

test("a changed injected epoch resets the three sessions, an unchanged one keeps them", () => {
  const { host } = setup({ revision: 7, file: null });
  inject(host, "2");
  stamp(host);
  fill(host);
  stamp(host);
  assert.deepEqual(sessions(host), [{ a: 1 }, { b: 2 }, { c: 3 }]);
  inject(host, "3");
  assert.equal(stamp(host).epoch, 3);
  assert.deepEqual(sessions(host), [null, null, null]);
});

test("with no injected epoch the file's own counter counts project object and path changes", () => {
  const { host, app } = setup({ revision: 4, file: { fsName: "/a.aep" } });
  assert.equal(stamp(host).epoch, 1);
  fill(host);
  assert.equal(stamp(host).epoch, 1);
  assert.deepEqual(sessions(host), [{ a: 1 }, { b: 2 }, { c: 3 }]);
  app.project = { revision: 1, file: { fsName: "/a.aep" } };
  assert.equal(stamp(host).epoch, 2, "a new project object is a new epoch");
  assert.deepEqual(sessions(host), [null, null, null]);
  app.project = { revision: 1, file: { fsName: "/b.aep" } };
  assert.equal(stamp(host).epoch, 3);
  app.project = { revision: 1, file: { fsName: "/b.aep" } };
  assert.equal(stamp(host).epoch, 4);
});

test("an invalid injected value falls back to the own counter", () => {
  for (const literal of ["-1", "1.5", '"2"', "NaN", "Infinity", "null", "true", "{}"]) {
    const { host } = setup({ revision: 5, file: null });
    inject(host, literal);
    assert.deepEqual(stamp(host), { epoch: 1, revision: 5 }, literal);
  }
});

test("removing the injected value returns to the own counter, which kept counting project changes", () => {
  const { host, app } = setup({ revision: 5, file: null });
  inject(host, "9");
  assert.equal(stamp(host).epoch, 9);
  app.project = { revision: 1, file: null };
  assert.equal(stamp(host).epoch, 9);
  remove(host);
  assert.equal(stamp(host).epoch, 2);
});

test("a stamp compares equal to itself and not to a stamp from another injected epoch", () => {
  const { host } = setup({ revision: 5, file: null });
  inject(host, "4");
  assert.equal(host.call("aeCollectionSameStamp({ epoch: 4, revision: 5 })"), true);
  assert.equal(host.call("aeCollectionSameStamp({ epoch: 1, revision: 5 })"), false);
});
