// Pictures of a variant card's options: the host lane renders them and the frame store holds them until the panel asks.
import { enqueueHostWork } from "./host/work-queue.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { ok, route, type MountedRoute } from "./server-route-table.js";
import { waitForState } from "./server-state-wait.js";
import { uiHostOf } from "./ui-host.js";
import { uiStoreFor } from "./ui-store.js";

const PREVIEW_WAIT_MS = 30_000;
const UNDO_GROUP = "extynt preview";
const MIN_CAPTURE_SIDE = 16;
const MAX_CAPTURE_SIDE = 4096;

function captureSize(pixels: number): boolean { return Number.isInteger(pixels) && pixels >= MIN_CAPTURE_SIDE && pixels <= MAX_CAPTURE_SIDE; }

function frameTime(composition: { duration: number; frameRate: number; currentTime?: number | null }): number {
  const step = composition.frameRate > 0 ? 1 / composition.frameRate : 0.001, last = composition.duration > 0 ? composition.duration - step : Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(composition.currentTime ?? 0, last));
}

function previewCommand(deps: HttpRoutesDeps, setId: string) {
  const set = deps.state.variants.get(setId);
  const composition = set ? deps.dispatch.normalizedLatest()?.compositions.find((entry) => entry.id === set.target.compositionId) : undefined;
  if (!set || set.status !== "open" || !composition || !captureSize(composition.width) || !captureSize(composition.height)) return null;
  const { compositionId, layerId, effectMatchName, effectPath, propertyPath } = set.target;
  const command = {
    operation: "preview_control_values", compositionId, layerId, effectMatchName, effectPath, propertyPath,
    candidates: set.candidates.map((candidate, index) => ({ id: `c${index}`, value: candidate.value })),
    capture: { idPrefix: `variant-${setId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40)}`, time: frameTime(composition), width: composition.width, height: composition.height }, undoGroup: UNDO_GROUP,
  };
  return { command, background: composition.backgroundColor };
}

async function requestPreview(deps: HttpRoutesDeps, host: NonNullable<ReturnType<typeof uiHostOf>>, setId: string, job: NonNullable<ReturnType<typeof previewCommand>>) {
  enqueueHostWork(deps.state, { approvedData: { kind: "preview_controls", setId, command: job.command, ...(job.background ? { background: job.background } : {}) } });
  await waitForState(deps.state, () => host.frames.previewFor(setId) !== undefined, PREVIEW_WAIT_MS);
  return ok({ ok: true, ...(host.frames.previewFor(setId) ?? { status: "none" }) });
}

async function previewOf(deps: HttpRoutesDeps, setId: string) {
  const host = uiHostOf(deps.state), known = host?.frames.previewFor(setId);
  if (known) return ok({ ok: true, ...known });
  const job = host && uiStoreFor(deps.state).prefs().showThumbnails ? previewCommand(deps, setId) : null;
  if (!host || !job) return ok({ ok: true, status: "none" });
  return requestPreview(deps, host, setId, job);
}

/** `POST /v1/variants/:setId/preview`: the pictures of the card's options, taken once and then kept. */
export const variantPreviewRoutes: readonly MountedRoute[] = [
  route({ method: "POST", path: "/v1/variants/:setId/preview", handle: ({ deps, param }) => previewOf(deps, param) }),
];
