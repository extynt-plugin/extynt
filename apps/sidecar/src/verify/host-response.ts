// Turns the text the host answered an apply or an undo with into a decoded reply; an answer that cannot be decoded reads as a failure whose effect on the project is unknown.
import { decodeJson } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";
import { applyReply, undoReply } from "./apply-reply.js";
import type { HostApplySuccess, HostFailure, HostUndoSuccess } from "./apply-reply.js";
import type { ApplyCommand, HostApplyResult } from "./host-types.js";

const UNREADABLE_REPLY: HostFailure = {
  ok: false,
  mayHaveMutated: true,
  mutationState: "unknown",
  error: { code: "INVALID_HOST_RESPONSE", message: "Host returned invalid JSON after dispatch; mutation outcome is unknown." },
};

function decodeReply<T>(decoder: Decoder<T>, hostResponse: string | null): T | HostFailure {
  const decoded = decodeJson(String(hostResponse), decoder);
  return decoded.ok ? decoded.value : UNREADABLE_REPLY;
}

function decodeApplyReply(hostResponse: string | null): HostApplySuccess | HostFailure {
  return decodeReply(applyReply, hostResponse);
}

function decodeUndoReply(hostResponse: string | null): HostUndoSuccess | HostFailure {
  return decodeReply(undoReply, hostResponse);
}

/** The answer in the loose shape the apply runners read; `undo` picks which kind of answer is expected. */
export function parseApplyHostResponse(hostResponse: string | null, undo: boolean): HostApplyResult {
  return undo ? decodeUndoReply(hostResponse) : decodeApplyReply(hostResponse);
}

/** The line the activity log opens an apply with: the plan and how many operations it holds. */
export function applyBeginDetail(command: ApplyCommand): string {
  return `${command.planId || "?"} ${Array.isArray(command.operations) ? command.operations.length : 0} operations`;
}
