/**
 * Confirms that a native readback proves the approved parameter write: the proof must name the plan, the read set, the one
 * target layer and the host that produced the snapshot, and show the desired value. A desired value or an unrelated fresh
 * snapshot cannot satisfy this binding.
 */
import type { MetadataReadSet } from "@extynt/action-plan";
import { isJsonArray } from "@extynt/decode";
import { jsonOf } from "@extynt/mcp-server";
import { stableStringify, type ProjectSnapshot } from "@extynt/project-graph";
import type { Opaque } from "./snapshot-view.js";
import { graphOrdinal, graphRecord, type GraphRecord } from "./graph-record.js";

function same(left: Opaque, right: Opaque): boolean {
  try { return stableStringify(left) === stableStringify(right); } catch { return false; }
}
function proofBinding(readSet: MetadataReadSet, proof: GraphRecord): boolean {
  const stamp = graphRecord(proof.stamp), epoch = graphOrdinal(stamp.epoch), revision = graphOrdinal(stamp.revision);
  return proof.planId === readSet.planId && proof.readSetDigest === readSet.digest && proof.complete === true
    && epoch === readSet.stamp.epoch && revision !== null && revision >= readSet.stamp.revision;
}
type Target = MetadataReadSet["targets"][number];
function onlyRow(proof: GraphRecord): GraphRecord | undefined {
  const rows = proof.rows;
  return isJsonArray(rows) && rows.length === 1 ? graphRecord(rows[0]) : undefined;
}
function rowBinding(row: GraphRecord, target: Target): boolean {
  if (row.operationIndex !== 0 || row.compositionId !== target.compositionId || row.layerId !== target.layerId) return false;
  return row.layerIndex === target.layerIndex && row.name === target.name && row.locked === false && typeof row.selected === "boolean" && row.value === target.desiredValue;
}
function layerBinding(target: Target, row: GraphRecord, proof: GraphRecord): boolean {
  const metadata = graphRecord(proof.metadata), layer = graphRecord(metadata.layer), composition = graphRecord(metadata.composition);
  if (composition.id !== target.compositionId || composition.itemIndex !== target.itemIndex) return false;
  return layer.id === target.layerId && layer.index === target.layerIndex && layer.name === target.name && layer.locked === false && layer.selected === row.selected;
}
function runtimeMatches(before: ProjectSnapshot, metadata: GraphRecord): boolean {
  const runtime = graphRecord(metadata.runtime), project = graphRecord(metadata.project);
  return runtime.application === before.host.application && runtime.appVersion === before.host.version && runtime.platform === before.host.platform && project.filePath === before.project.filePath;
}
function compositionMatches(composition: GraphRecord, source: ProjectSnapshot["compositions"][number]): boolean {
  return composition.name === source.name && composition.width === source.width && composition.height === source.height && composition.duration === source.duration && composition.frameRate === source.frameRate;
}
function metadataBinding(target: Target, before: ProjectSnapshot, proof: GraphRecord): boolean {
  const metadata = graphRecord(proof.metadata), source = before.compositions.find(value => value.id === target.compositionId);
  return !!source && runtimeMatches(before, metadata) && compositionMatches(graphRecord(metadata.composition), source);
}
function boundTarget(readSet: MetadataReadSet, proof: GraphRecord): { target: Target; row: GraphRecord } | undefined {
  const row = onlyRow(proof), [target] = readSet.targets;
  return row && target && readSet.targets.length === 1 && proofBinding(readSet, proof) && rowBinding(row, target) ? { target, row } : undefined;
}
interface ParameterReadbackProof { readSet: MetadataReadSet; before: ProjectSnapshot; readback: Opaque }
/** The proof when the readback satisfies every binding of the approved read set; undefined otherwise. */
export function confirmedParameterReadback(input: ParameterReadbackProof): GraphRecord | undefined {
  const proof = graphRecord(input.readback), { readSet, before } = input;
  const bound = readSet.schemaVersion === "blur-control-read-set/1" ? boundTarget(readSet, proof) : undefined;
  if (!bound || !layerBinding(bound.target, bound.row, proof) || !metadataBinding(bound.target, before, proof)) return undefined;
  const effect = bound.target.localEffect;
  return effect && same(proof.localEffect, jsonOf({ ...effect, value: bound.target.desiredValue })) ? proof : undefined;
}
