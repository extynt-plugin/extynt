/** Keeps one chat's built work out of another chat's carried project context. */
interface Fence {
  current: string | undefined;
  readonly owners: Map<string, string>;
}

interface JobLedger {
  readonly jobs: Readonly<Record<string, { readonly jobId: string }>>;
}

interface FenceKey {
  getState(): JobLedger;
}

const UNKNOWN_OWNER = "";
const fences = new WeakMap<FenceKey, Fence>();

function fenceOf(key: FenceKey): Fence {
  const found = fences.get(key);
  if (found) return found;
  const created: Fence = { current: undefined, owners: new Map() };
  fences.set(key, created);
  return created;
}

/** A turn of `sessionId` begins: jobs that exist now but belong to no chat yet are the previous chat's. */
export function enterChatSession(key: FenceKey, sessionId: string | undefined): void {
  if (sessionId === undefined) return;
  const fence = fenceOf(key);
  if (fence.current === sessionId) return;
  for (const jobId of Object.keys(key.getState().jobs)) if (!fence.owners.has(jobId)) fence.owners.set(jobId, fence.current ?? UNKNOWN_OWNER);
  fence.current = sessionId;
}

/** Job ids that another chat built, so the current chat does not carry them. */
export function foreignJobs(key: FenceKey): ReadonlySet<string> {
  const fence = fences.get(key);
  if (!fence?.current) return new Set();
  const hidden = new Set<string>();
  for (const [jobId, owner] of fence.owners) if (owner !== fence.current) hidden.add(jobId);
  return hidden;
}
