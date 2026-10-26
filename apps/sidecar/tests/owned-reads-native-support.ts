/**
 * What the sidecar-owned-reads cases share: a project of footage and two compositions as the plugin reads it, the edits a user makes
 * to it (a layer renamed, a composition added), and the reads the sidecar asked the plugin for.
 */
import { isJsonObject } from "@extynt/decode";
import type { JsonArray, JsonValue } from "@extynt/decode";
import { makeLayer, makeProject } from "@extynt/fake-plugin";
import type { FakePlugin, FixtureComposition, FixtureLayer, FixtureProject } from "@extynt/fake-plugin";
import type { HostRig } from "./host-rig.js";
import { fieldOf, maybeListOf, maybeTextOf } from "./http-json.js";
import type { Found } from "./http-json.js";

const layerIdOf = (compId: string, index: number): string => String(Number(compId) * 100 + index);

function layerOf(compId: string, index: number, name: string): FixtureLayer {
  const id = layerIdOf(compId, index);
  return makeLayer(id, index, { name, hash: `h-${id}-${name}` });
}

function compositionOf(id: string, names: string[]): FixtureComposition {
  return { id, name: `Comp ${id}`, width: 1920, height: 1080, pixelAspect: 1, duration: 10, frameRate: 24, currentTime: 0, truncated: false, layers: names.map((name, at) => layerOf(id, at + 1, name)) };
}

/** Footage 1, composition 2 ("Title", "Backdrop") and composition 3 ("Lower third"); composition 2 is the one open. */
export function ownedProject(): FixtureProject {
  const project = makeProject();
  project.itemCount = 3;
  project.items = [
    { id: "1", name: "Footage 1", type: "footage", parentFolderId: "0", compositionId: null, sourceId: "7" },
    { id: "2", name: "Comp 2", type: "composition", parentFolderId: "0", compositionId: "2", sourceId: null },
    { id: "3", name: "Comp 3", type: "composition", parentFolderId: "0", compositionId: "3", sourceId: null },
  ];
  project.compositions = [compositionOf("2", ["Title", "Backdrop"]), compositionOf("3", ["Lower third"])];
  project.activeCompositionId = "2";
  return project;
}

export function renameLayer(project: FixtureProject, compId: string, index: number, name: string): void {
  const composition = project.compositions.find((candidate) => candidate.id === compId);
  if (composition) composition.layers[index - 1] = layerOf(compId, index, name);
}

/** A composition made while the item list grows, and the one After Effects now shows. */
export function addComposition(plugin: FakePlugin, id: string, names: string[]): void {
  const project = plugin.state.project;
  project.compositions.push(compositionOf(id, names));
  project.items = [...(project.items ?? []), { id, name: `Comp ${id}`, type: "composition", parentFolderId: "0", compositionId: id, sourceId: null }];
  project.itemCount += 1;
}

export interface ReadOp { op: string; compId?: string; detail?: string }

const isReadOp = (name: string): boolean => name === "read_project" || name === "read_comp" || name === "read_paths";

function readOpOf(op: JsonValue): ReadOp | undefined {
  const name = maybeTextOf(op, "op");
  if (name === undefined || !isReadOp(name)) return undefined;
  const compId = maybeTextOf(op, "compId");
  const detail = maybeTextOf(op, "detail");
  return { op: name, ...(compId === undefined ? {} : { compId }), ...(detail === undefined ? {} : { detail }) };
}

/** The reads the plugin was asked for, in order, from every batch it received since `from` batches. */
export function readOps(plugin: FakePlugin, from = 0): ReadOp[] {
  const found: ReadOp[] = [];
  for (const request of plugin.requestsFor("batch").slice(from)) {
    for (const op of maybeListOf(request.body, "ops") ?? []) {
      const read = readOpOf(op);
      if (read) found.push(read);
    }
  }
  return found;
}

export const batchCount = (plugin: FakePlugin): number => plugin.requestsFor("batch").length;

/** One member of the stored snapshot's result, whatever its type. */
export function snapshotMember(rig: HostRig, key: string): Found {
  return fieldOf(rig.sidecar.latest?.snapshot.result, key);
}

export function snapshotList(rig: HostRig, key: string): JsonArray {
  return maybeListOf(rig.sidecar.latest?.snapshot.result, key) ?? [];
}

/** What the sidecar holds of the project: composition ids in order, and the name of one layer. */
export function storedCompositions(rig: HostRig): Array<{ id: string; layerNames: string[] }> {
  return snapshotList(rig, "compositions").filter(isJsonObject).map((composition) => ({
    id: String(composition.id),
    layerNames: (maybeListOf(composition, "layers") ?? []).filter(isJsonObject).map((layer) => String(layer.name)),
  }));
}

/** A paired rig whose first full read, and the census after it, have landed: the state every edit case starts from. */
export async function landFirstRead(rig: HostRig): Promise<void> {
  rig.pair();
  await rig.settle();
  rig.timers.fire();
  await rig.drain();
}
