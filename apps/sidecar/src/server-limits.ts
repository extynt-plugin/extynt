// The bounds, timings and status sets the sidecar's request handling shares.
import type { StoredReceipt } from "@extynt/mcp-server";

/** The schema version of probe snapshots and censuses. */
export const SNAPSHOT_SCHEMA_VERSION = "0.1";

/** The largest request body the sidecar reads, in bytes. */
export const DEFAULT_MAX_BODY_BYTES = 8_000_000;

/** The most agent mailbox items held at once. */
export const MAX_AGENT_MAILBOX_ITEMS = 32;

/** How many seconds a batch gets to settle before its call reports it still running. */
export const BATCH_SETTLE_SECONDS = 45;

/** How long an approved plan may wait for the panel to claim it: the pre-apply probe is a full read, which a busy host can take most of a minute to answer. */
export const APPROVED_CLAIM_GRACE_MS = 60_000;

/** How often approvals nobody claimed are swept. */
export const APPROVAL_SWEEP_INTERVAL_MS = 5_000;

/** The longest steering message, in characters. */
export const MAX_STEER_CHARS = 4_000;

/** The most steering messages held for one turn. */
export const MAX_STEER_MESSAGES = 4;

/** How long a superseded chat turn gets to settle. */
export const CHAT_SUPERSEDE_SETTLE_MS = 15_000;

/** How long the panel will wait for one chat turn: advisory for the model's benefit, not enforcement. */
export const CHAT_TURN_ADVISORY_MS = 900_000;

/** When the turn is told to land: far enough before the ceiling that the steps which write and seal the queue still fit. */
export const CHAT_TURN_LANDING_MS = 540_000;

export const MAILBOX_TOOLS = new Set(["ae_approve_plan", "ae_capture_composition_frame", "ae_refresh_snapshot", "ae_undo_plan", "ae_undo_agent_work"]);

/** The statuses of a plan the host is working on. */
export const IN_FLIGHT_PLAN_STATUSES = new Set(["approved", "applying", "undo_requested"]);

export const TERMINAL_PLAN_STATUSES = new Set(["verified", "applied", "applied_unverified", "failed", "cancelled", "undone", "undo_unverified"]);

/** A ready-queue entry is finished when its plan vanished, landed a receipt, or reached a terminal status. */
export function readyPlanFinished(record: { receipt?: StoredReceipt | null | undefined; status: string } | undefined): boolean {
  return !record || Boolean(record.receipt) || TERMINAL_PLAN_STATUSES.has(record.status);
}

/** The most plan records kept. */
export const MAX_PLAN_RECORDS = 256;

/** The most superseded probes remembered. */
export const MAX_SUPERSEDED_PROBES = 64;

/** Entries the panel's repair packet may itemise; the rest are its `failedCount`. */
export const MAX_REPAIR_OPERATIONS = 8;

/** The most seconds one agent call may wait; one call cannot hold a turn open. */
export const AGENT_WAIT_MAX_SECONDS = 60;

/** The seconds each waiting tool waits by default; sealing tools share one allowance across the pre-seal wait and the apply wait. */
export const AGENT_DEFAULT_WAIT_SECONDS: Readonly<Record<string, number>> = { ae_approve_plan: 20, ae_refresh_snapshot: 10, ae_capture_composition_frame: 15, ae_undo_plan: 20, ae_undo_agent_work: 20, ae_get_plan_status: 15, ae_get_capture_frame: 15, ae_observe_frame: 15, ae_plan_complete: BATCH_SETTLE_SECONDS, ae_queue_finish: BATCH_SETTLE_SECONDS };

/** The most plans the ready queue holds by default. */
export const READY_PLAN_QUEUE_LIMIT = 32;
