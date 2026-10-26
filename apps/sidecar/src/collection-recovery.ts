// What a caller should do next when a graph demand fails or is not ready: advice that describes infrastructure state and never releases or retries native work.

interface RecoveryAdvice { action: string; tool?: string; automaticRetry: false; message: string }

function advice(action: string, message: string, tool?: string): RecoveryAdvice {
  return { action, ...(tool === undefined ? {} : { tool }), automaticRetry: false, message };
}

const WAIT_FOR_DEMAND = advice("wait-for-existing-demand", "Wait using this demandId; do not create a duplicate native demand.", "ae_get_graph_page");
const FRESH_READ = advice("demand-fresh-evidence", "The read did not complete and its ticket is retired. A read cannot change the project, but old coverage is unknown, never absent. Once the bridge is idle, begin a fresh bounded demand for the intended target.");
const WAIT_FOR_SETTLEMENT = advice("wait-for-native-settlement", "Do not redispatch yet. The earlier call may still be running in After Effects; a read cannot change the project, and the ticket is retired after 60 s or when the panel replaces it. If a mutation is unresolved, wait for AE to settle before reading again.");
const STALE_COVERAGE = advice("demand-fresh-evidence", "Old coverage is unknown or stale, never absent. Once the bridge is idle, begin a fresh bounded demand for the intended target; do not reuse the old cursor or approval.");
const INSPECT = advice("inspect-request-or-coverage", "Check the exact target and returned error. Unsupported or unavailable fields remain unknown; no write was authorized.");
const OFFLINE = advice("open-after-effects", "After Effects is not connected, so no page can be read from it. Ask the user to open After Effects (the extynt plugin connects by itself), then demand the page again. Cached reads such as ae_get_project_overview still answer from the last read, marked as offline.");
const PAIR = advice("pair-panel", "Connect and pair the extynt panel before demanding a native page.");
const CORRECT_TARGET = advice("correct-target", "target.kind is index, layers, properties, values, blur or effect-create. Every kind but index needs itemIndex (integer) and compositionId; properties, values, blur and effect-create also need layerIndex (integer) and layerId; values needs propertyIndices (1 to 16 integers). Take the ordinals and ids from the index and layers pages.");
const CORRECT_STAMP = advice("correct-target", "values, blur and effect-create need target.expectedStamp: the epoch and revision integers from the stamp of the descriptor page, as returned.");
const WAIT_FOR_CAPACITY = advice("wait-for-bridge-capacity", "Wait for admitted reads or approved writes to settle before requesting another bounded page.");

function bound(entries: ReadonlyArray<readonly [RecoveryAdvice, readonly string[]]>): ReadonlyMap<string, RecoveryAdvice> {
  return new Map(entries.flatMap(([step, codes]) => codes.map((code): [string, RecoveryAdvice] => [code, step])));
}

const BEFORE_SETTLEMENT = bound([
  [WAIT_FOR_DEMAND, ["DEMAND_PENDING"]],
  [FRESH_READ, ["DEMAND_TIMEOUT", "COLLECTION_TIMED_OUT", "COLLECTION_PANEL_REPLACED"]],
]);
const AFTER_SETTLEMENT = bound([
  [FRESH_READ, ["COLLECTION_QUARANTINED", "HOST_TIMEOUT", "HOST_DISPATCH_UNKNOWN"]],
  [OFFLINE, ["HOST_OFFLINE"]],
  [PAIR, ["PANEL_NOT_PAIRED"]],
  [CORRECT_TARGET, ["INVALID_COLLECTION_TARGET"]],
  [CORRECT_STAMP, ["INVALID_COLLECTION_STAMP"]],
  [WAIT_FOR_CAPACITY, ["COLLECTION_BUSY", "MAILBOX_FULL", "DEMAND_MEMORY_LIMIT"]],
  [STALE_COVERAGE, ["DEMAND_NOT_FOUND", "STALE_COLLECTION", "STALE_COLLECTION_TICKET", "PROJECT_CHANGED", "COLLECTION_CANCELLED", "DEMAND_CANCELLED", "STALE_EVIDENCE"]],
]);

/** The next step for a failure code; a ticket that may still be running in After Effects calls for waiting rather than a fresh read. */
export function recovery(code: string, unresolved = false): RecoveryAdvice {
  const early = BEFORE_SETTLEMENT.get(code);
  if (early) return early;
  if (unresolved || code === "HOST_QUARANTINED") return WAIT_FOR_SETTLEMENT;
  return AFTER_SETTLEMENT.get(code) ?? INSPECT;
}
