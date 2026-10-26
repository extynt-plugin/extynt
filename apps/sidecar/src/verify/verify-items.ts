// The verdict for each operation on a project item: files saved or collected, items created, renamed, moved, deleted or cleaned up.
import { hostVerification } from "./host-step.js";
import type { HostStep } from "./host-step.js";
import type { Request } from "./plan-request.js";
import type { SnapshotItem } from "./snapshot-reply.js";
import { compOf, itemOf } from "./verify-context.js";
import type { VerifyContext } from "./verify-context.js";
import { verifyProjectCleanup } from "./verify-output.js";
import { verifyVectorArtworkCreated } from "./verify-vector.js";
import { exactStep, failedStep, judged, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";
import { writtenFileVerdict } from "./written-file.js";

interface ItemCall {
  readonly ctx: VerifyContext;
  readonly request: Request;
  readonly step: HostStep;
  readonly item: SnapshotItem;
}

function verifyRename(call: ItemCall): VerifiedStep {
  return judged(call.item.name === call.request.name, call.request.operation, { pass: "project-item-name", fail: "project-item-name-mismatch" }, { itemId: call.item.id });
}

function verifyCreated(call: ItemCall): VerifiedStep {
  const { request, step, item } = call;
  const kind = request.operation;
  const ids = { itemId: item.id };
  const confirmed = item.name === step.name && (step.parentFolderId === undefined || item.parentFolderId === step.parentFolderId);
  return confirmed ? exactStep(kind, "project-item-exists-name-parent", ids) : unverifiedStep(kind, "host-item-created-snapshot-partial", ids);
}

function verifyVector(call: ItemCall): VerifiedStep {
  return verifyVectorArtworkCreated({ request: call.request, step: call.step, item: call.item, comp: compOf(call.ctx, call.item.id) });
}

function verifyMoved(call: ItemCall): VerifiedStep {
  const { ctx, request, item } = call;
  const folderId = request.folderId === null || request.folderId === undefined ? request.folderId : (ctx.ids.items.get(request.folderId) ?? request.folderId);
  const matches = item.parentFolderId === folderId;
  return judged(matches, request.operation, { pass: "project-item-parent", fail: "project-item-parent-mismatch" }, { itemId: item.id, parentFolderId: matches ? folderId : item.parentFolderId });
}

const FOUND_ITEM_VERIFIERS: Readonly<Record<string, (call: ItemCall) => VerifiedStep>> = {
  set_item_name: verifyRename,
  create_folder: verifyCreated,
  import_file: verifyCreated,
  create_vector_artwork: verifyVector,
  move_item_to_folder: verifyMoved,
};

function verifyProjectFile(kind: string, step: HostStep): VerifiedStep | null {
  const mode = step.mode ?? null;
  if (kind === "switch_project") return unverifiedStep(kind, "project-switch-host-evidence", { mode, file: step.file ?? null });
  if (kind !== "save_project" && kind !== "collect_project") return null;
  return writtenFileVerdict(kind, step, { mode }) ?? unverifiedStep(kind, "project-save-host-evidence", { mode });
}

function itemIdOf(ctx: VerifyContext, request: Request, step: HostStep): string | undefined {
  const requested = request.itemId || request.newFolderId || request.newItemId;
  return step.itemId || step.folderId || (requested === undefined ? undefined : ctx.ids.items.get(requested)) || requested;
}

interface AbsentCall {
  readonly ctx: VerifyContext;
  readonly request: Request;
  readonly step: HostStep;
  readonly item: SnapshotItem | null;
  readonly itemId: string | undefined;
}

function verifyAbsentItem(call: AbsentCall): VerifiedStep | null {
  const { ctx, request, step, item, itemId } = call;
  const kind = request.operation;
  if (kind === "delete_project_item") return judged(!item, kind, { pass: "project-item-absent", fail: "project-item-still-present" }, { itemId });
  return kind === "cleanup_project" ? verifyProjectCleanup(kind, step, ctx) : null;
}

/** The verdict for an operation on a project item or on the project file itself. */
export function verifyItemOperation(ctx: VerifyContext, index: number): VerifiedStep {
  const request = ctx.requests[index];
  const step = ctx.steps[index];
  if (!request || !step) return unverifiedStep("", "no-verifier-result");
  const kind = request.operation;
  const itemId = itemIdOf(ctx, request, step);
  const item = itemOf(ctx, itemId);
  const settled = verifyProjectFile(kind, step) ?? verifyAbsentItem({ ctx, request, step, item, itemId });
  if (settled) return settled;
  if (!item) return failedStep(kind, "project-item-missing", { itemId });
  const verifier = FOUND_ITEM_VERIFIERS[kind];
  return verifier ? verifier({ ctx, request, step, item }) : unverifiedStep(kind, "host-footage-write-no-observable-state", { itemId: item.id, ...hostVerification(step) });
}
