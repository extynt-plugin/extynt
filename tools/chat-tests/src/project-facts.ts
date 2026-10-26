/**
 * Facts about the project after a turn, checked on the fixture host's snapshot. They pin structure (a parent, an
 * expression, a created comp) and never wording. A fact is `name:arg[:arg]`; an unknown name fails loudly.
 */
import { flattenProperties, type CompositionSnapshot, type LayerSnapshot, type ProjectSnapshot } from "@extynt/project-graph";

export interface FactContext { snapshot: ProjectSnapshot; initial: ProjectSnapshot }
type Check = (args: readonly string[], context: FactContext) => string | undefined;

const named = (snapshot: ProjectSnapshot, name: string): CompositionSnapshot[] => snapshot.compositions.filter((composition) => composition.name === name);
const layerById = (snapshot: ProjectSnapshot, id: string): LayerSnapshot | undefined =>
  snapshot.compositions.flatMap((composition) => composition.layers).find((layer) => layer.id === id);
const expressionOf = (layer: LayerSnapshot): string =>
  flattenProperties(layer.properties)
    .filter((property) => property.expressionEnabled !== false)
    .map((property) => property.expression ?? "")
    .join("\n");

function parentNull(snapshot: ProjectSnapshot, layerId: string): { layer?: LayerSnapshot; parent?: LayerSnapshot } {
  const layer = layerById(snapshot, layerId);
  const parent = layer?.parentId ? layerById(snapshot, layer.parentId) : undefined;
  return { ...(layer ? { layer } : {}), ...(parent ? { parent } : {}) };
}

const CHECKS: Readonly<Record<string, Check>> = {
  "comp-with-solid": ([name = ""], { snapshot }) => {
    const solids = new Set((snapshot.sources ?? []).filter((source) => source.type === "solid").map((source) => source.id));
    const found = named(snapshot, name).find((composition) => composition.layers.some((layer) => layer.type === "av" && layer.sourceId !== null && solids.has(layer.sourceId)));
    return found ? undefined : `no composition "${name}" holds a solid layer`;
  },
  "no-composition": ([name = ""], { snapshot }) => (named(snapshot, name).length ? `composition "${name}" still exists` : undefined),
  "compositions-unchanged": (_args, { snapshot, initial }) => {
    const before = new Set(initial.compositions.map((composition) => composition.id));
    const added = snapshot.compositions.filter((composition) => !before.has(composition.id));
    return added.length ? `new composition(s) appeared: ${added.map((composition) => composition.name).join(", ")}` : undefined;
  },
  "parent-is-null": ([layerId = ""], { snapshot }) => {
    const { layer, parent } = parentNull(snapshot, layerId);
    if (!layer) return `layer ${layerId} does not exist`;
    return parent?.type === "null" ? undefined : `layer ${layerId} has no null parent`;
  },
  "parent-null-expression": ([layerId = "", ...needle], { snapshot }) => {
    const { parent } = parentNull(snapshot, layerId);
    if (parent?.type !== "null") return `layer ${layerId} has no null parent`;
    return expressionOf(parent).includes(needle.join(":")) ? undefined : `the null parent of ${layerId} has no expression containing "${needle.join(":")}"`;
  },
};

/** Whether the fact's name is one the checker knows. */
export function isKnownFact(fact: string): boolean {
  return Object.hasOwn(CHECKS, fact.split(":")[0] ?? "");
}

/** Why each fact does not hold, or nothing when they all do. */
export function factFailures(facts: readonly string[], context: FactContext): string[] {
  const failures: string[] = [];
  for (const fact of facts) {
    const [name = "", ...args] = fact.split(":");
    const check = Object.hasOwn(CHECKS, name) ? CHECKS[name] : undefined;
    const failure = check ? check(args, context) : `unknown project fact "${name}"`;
    if (failure) failures.push(`${fact}: ${failure}`);
  }
  return failures;
}
