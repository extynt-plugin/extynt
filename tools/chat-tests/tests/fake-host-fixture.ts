/** The fixture project and the lookups the fake-host tests share. */
import assert from "node:assert/strict";
import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { compositionAsset } from "../src/assets.js";
import { applyOperationsToFixture, type FixtureApplyResult } from "../src/fake-host.js";
import { fixtureSnapshotFromProbe } from "../src/fake-host-probe.js";
import type { WireObject } from "../src/wire-types.js";

export const POSITION = "ADBE Transform Group/ADBE Position";
export const OPACITY = "ADBE Transform Group/ADBE Opacity";

export function fixture(): ProjectSnapshot { return fixtureSnapshotFromProbe(compositionAsset("summer-launch").probe); }

export function apply(snapshot: ProjectSnapshot, operations: readonly WireObject[], revision?: string): FixtureApplyResult {
  return applyOperationsToFixture({ snapshot, operations, ...(revision === undefined ? {} : { revision }) });
}

export function compositionOf(snapshot: ProjectSnapshot, compositionId: string): CompositionSnapshot {
  const composition = snapshot.compositions.find((candidate) => candidate.id === compositionId);
  assert.ok(composition, `composition ${compositionId} should exist`);
  return composition;
}

export function layerOf(snapshot: ProjectSnapshot, compositionId: string, layerId: string): LayerSnapshot {
  const layer = compositionOf(snapshot, compositionId).layers.find((candidate) => candidate.id === layerId);
  assert.ok(layer, `layer ${layerId} should exist`);
  return layer;
}

export function propertyOf(layer: LayerSnapshot, path: string): PropertySnapshot {
  const found: PropertySnapshot[] = [];
  const visit = (properties: PropertySnapshot[]) => {
    for (const property of properties) {
      if (property.path === path) found.push(property);
      if (property.children) visit(property.children);
    }
  };
  visit(layer.properties);
  assert.equal(found.length, 1, `expected exactly one ${path} on ${layer.id}`);
  const [only] = found;
  assert.ok(only);
  return only;
}

export function requiredChild(node: PropertySnapshot, matchName: string, message: string): PropertySnapshot {
  const child = node.children?.find((candidate) => candidate.matchName === matchName);
  assert.ok(child, message);
  return child;
}

export function layerChild(layer: LayerSnapshot, matchName: string): PropertySnapshot | undefined {
  return layer.properties.find((property) => property.matchName === matchName);
}

export function requiredLayerChild(layer: LayerSnapshot, matchName: string, message: string): PropertySnapshot {
  const child = layerChild(layer, matchName);
  assert.ok(child, message);
  return child;
}
