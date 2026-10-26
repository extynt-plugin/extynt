// Finding native operations by id, plan type or search words.
import { compareText } from "./canonical.js";
import type { NativeOperationDefinition } from "./native-operation-types.js";
import { NATIVE_OPERATION_REGISTRY } from "./native-registry.js";
import { queryTokens } from "./token-search.js";

/** The most rows one search answers; the whole registry fits. */
export const MAX_NATIVE_SEARCH_RESULTS = 150;

function nativePlanVocabulary(entry: NativeOperationDefinition): string[] {
  const fields = [entry.inputSchema, ...Object.values(entry.planSchemas ?? {})].flatMap((schema) => Object.keys(schema.properties));
  return [entry.id, entry.domain, entry.description, entry.aeTarget, ...entry.planTypes, ...fields];
}

function tokenTier(entry: NativeOperationDefinition, token: string): number | undefined {
  const names = [entry.id, ...entry.planTypes].map((name) => name.toLowerCase());
  if (names.includes(token)) return 0;
  if (names.some((name) => name.startsWith(token))) return 1;
  if (names.some((name) => name.includes(token))) return 2;
  return nativePlanVocabulary(entry).some((value) => value.toLowerCase().includes(token)) ? 3 : undefined;
}
/** Registry search ranks by how many query words an entry's vocabulary holds (id, domain, description, aeTarget, plan types, input fields), then by how closely they name it; one matching word is enough. */
export function searchNativeOperations(query: string, limit = 25, registry: readonly NativeOperationDefinition[] = NATIVE_OPERATION_REGISTRY): NativeOperationDefinition[] {
  const bounded = Math.max(1, Math.min(MAX_NATIVE_SEARCH_RESULTS, limit));
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [...registry].sort((a, b) => compareText(a.id, b.id)).slice(0, bounded);
  const scored = registry.flatMap((entry) => {
    const tiers = tokens.flatMap((token) => tokenTier(entry, token) ?? []);
    return tiers.length ? [{ entry, matched: tiers.length, closeness: tiers.reduce((sum, tier) => sum + tier, 0) }] : [];
  });
  scored.sort((a, b) => b.matched - a.matched || a.closeness - b.closeness || compareText(a.entry.id, b.entry.id));
  return scored.slice(0, bounded).map((row) => row.entry);
}

/** Resolve a registry entry by operation id or by an ActionPlan `type` such as animate_property. The first match only: use findNativeOperations when every entry that answers to a plan type is needed. */
export function findNativeOperation(idOrPlanType: string, registry: readonly NativeOperationDefinition[] = NATIVE_OPERATION_REGISTRY): NativeOperationDefinition | undefined {
  return registry.find((entry) => entry.id === idOrPlanType) ?? registry.find((entry) => entry.planTypes.includes(idOrPlanType));
}

/** Every entry that answers to an operation id or plan type, primary first, in registry order; findNativeOperation is for callers that need one entry. */
export function findNativeOperations(idOrPlanType: string, registry: readonly NativeOperationDefinition[] = NATIVE_OPERATION_REGISTRY): NativeOperationDefinition[] {
  const byId = registry.find((entry) => entry.id === idOrPlanType);
  if (byId) return [byId];
  return registry.filter((entry) => entry.planTypes.includes(idOrPlanType));
}
const UNDO_RANK: Readonly<Record<NativeOperationDefinition["undoability"], number>> = { "undo-group": 0, "host-dependent": 1, "not-undoable": 2 };

/** What After Effects does with a plan type when Undo is pressed; one plan type can be performed by entries with different answers. */
export function planTypeUndoability(planType: string, registry: readonly NativeOperationDefinition[] = NATIVE_OPERATION_REGISTRY): NativeOperationDefinition["undoability"] {
  const answers = registry.filter((entry) => entry.planTypes.includes(planType)).map((entry) => entry.undoability);
  return answers.reduce((worst, answer) => (UNDO_RANK[answer] > UNDO_RANK[worst] ? answer : worst), "undo-group");
}
