/** The identifiers that cross panel modules, each branded so a plan id cannot stand in for a job or a chat. */
import { brand, decodeOrThrow, string } from "@extynt/decode";
import type { Brand, Decoder } from "@extynt/decode";

/** The id of a plan the sidecar holds. */
export type PlanId = Brand<string, "PlanId">;
/** The id of a stored chat. */
export type SessionId = Brand<string, "SessionId">;

/** Accepts any non-empty text as a plan id. */
export const planIdDecoder: Decoder<PlanId> = brand("PlanId", string({ nonEmpty: true }));
/** Accepts any non-empty text as a job id. */
export const jobIdDecoder: Decoder<Brand<string, "JobId">> = brand("JobId", string({ nonEmpty: true }));
/** Accepts any non-empty text as a chat id. */
export const sessionIdDecoder: Decoder<SessionId> = brand("SessionId", string({ nonEmpty: true }));

/** A fresh id for a chat the panel starts. */
export function newSessionId(): SessionId {
  return decodeOrThrow(sessionIdDecoder, Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
}
