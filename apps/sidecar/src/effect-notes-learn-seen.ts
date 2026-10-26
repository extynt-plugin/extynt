// Reads the effects and static control values an accepted snapshot shows, keyed by where they were seen so a re-read refreshes instead of double counting.
import { decodeOrThrow } from "@extynt/decode";
import { extractEffects, flattenProperties, type EffectSnapshot, type ProjectSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { createHash } from "node:crypto";
import { staticValue } from "./effect-notes-plan-facts.js";
import type { EffectNotesService } from "./effect-notes-service.js";
import type { SeenEventInput, SeenUsageInput } from "./effect-notes-types.js";

const SEEN_VALUES_PER_SNAPSHOT = 500;
const SEEN_EFFECTS_PER_SNAPSHOT = 500;
const SIBLING_SUFFIX = /#(?:[2-9]|[1-9][0-9]+)$/;
const learned = new WeakMap<EffectNotesService, string>();

interface Sightings { values: SeenUsageInput[]; effects: SeenEventInput[] }

function isStatic(property: PropertySnapshot): boolean {
  return property.kind === "property" && !property.keyframes?.length && !property.keyframeCount && property.expressionEnabled !== true;
}

function relativeControl(effectPath: string, property: PropertySnapshot): string | undefined {
  const prefix = `${effectPath}/`;
  if (!property.path.startsWith(prefix) || property.path.length === prefix.length) return undefined;
  return property.path.slice(prefix.length).split("/").map((segment) => segment.replace(SIBLING_SUFFIX, "")).join("/");
}

function effectValues(effect: EffectSnapshot, where: string): SeenUsageInput[] {
  return flattenProperties(effect.properties).flatMap((property) => {
    const value = isStatic(property) ? decodeOrThrow(staticValue, property.value) : undefined, control = relativeControl(effect.path, property);
    return value === undefined || control === undefined ? [] : [{ matchName: effect.matchName, controlPath: control, value, key: `${where}|${effect.path}|${control}` }];
  });
}

function projectKey(snapshot: ProjectSnapshot): string {
  return createHash("sha256").update(`${snapshot.project.filePath ?? ""}\0${snapshot.project.name}`).digest("hex").slice(0, 16);
}

function collect(snapshot: ProjectSnapshot): Sightings {
  const project = projectKey(snapshot), found: Sightings = { values: [], effects: [] };
  for (const composition of snapshot.compositions) for (const layer of composition.layers ?? []) {
    const where = `${project}|${composition.id}|${layer.id}`;
    for (const effect of extractEffects(layer)) {
      found.effects.push({ kind: "effect", name: effect.matchName, key: where });
      found.values.push(...effectValues(effect, where));
    }
    if (found.effects.length >= SEEN_EFFECTS_PER_SNAPSHOT && found.values.length >= SEEN_VALUES_PER_SNAPSHOT) break;
  }
  return { values: found.values.slice(0, SEEN_VALUES_PER_SNAPSHOT), effects: found.effects.slice(0, SEEN_EFFECTS_PER_SNAPSHOT) };
}

/** Effects and control values present in an accepted snapshot, keyed by project, composition, layer, effect and control; a snapshot already learned is skipped outright. */
export function learnSeenFromSnapshot(notes: EffectNotesService, snapshot: ProjectSnapshot): void {
  if (!notes.learnFromWork() || learned.get(notes) === snapshot.fingerprint) return;
  const found = collect(snapshot);
  if (found.effects.length) notes.recordSeenEvents(found.effects);
  if (found.values.length) notes.recordSeenUsage(found.values);
  learned.set(notes, snapshot.fingerprint);
}
