/** Explains a failed native read before an approved apply is admitted. */
import { decode, fallback, number, object, optional, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import type { HostSnapshot, PreApplyFailure } from "./host-types.js";

const UNCHANGED = " Nothing was run; the project is unchanged.";
const IDLE = " Apply again when After Effects is idle.";

const limitDetails = object({ bytes: optional(fallback(number(), undefined)), limit: optional(fallback(number(), undefined)) });
const reportedError = object({ code: optional(fallback(string(), undefined)), message: optional(fallback(string(), undefined)), details: optional(fallback(limitDetails, undefined)) });

interface ReadFailure {
  readonly code: string;
  readonly said: string;
  readonly details: Infer<typeof limitDetails>;
}

function readWords(value: string | null | undefined): string {
  return (value ?? "").replace(/[^A-Za-z0-9 .,:;\/()_+=%'-]+/g, " ").replace(/\s+/g, " ").replace(/^ | $/g, "").slice(0, 96);
}

function sentence(text: string): string {
  return text && !text.endsWith(".") ? `${text}.` : text;
}

function readFailure(raw: string | null, parsed: HostSnapshot | null): ReadFailure {
  const decoded = decode(reportedError, parsed?.error);
  const reported = decoded.ok ? decoded.value : {};
  return { code: reported.code || "HOST_READ_FAILED", said: sentence(readWords(decoded.ok ? decoded.value.message : raw)), details: reported.details ?? {} };
}

function retryable(code: string, message: string): PreApplyFailure {
  return { code, retryable: true, message };
}

function final(code: string, message: string): PreApplyFailure {
  return { code, retryable: false, message };
}

function projectFailure(code: string, compositionId: string | null): PreApplyFailure | null {
  if (code === "NO_PROJECT") return final(code, `No project is open in After Effects, so nothing could be read before applying.${UNCHANGED} Open the project and apply again.`);
  if (code !== "NO_ACTIVE_COMPOSITION") return null;
  const named = compositionId ? `, id ${readWords(compositionId)},` : "";
  return final(code, `The item active in After Effects is not a composition, so nothing could be read before applying.${UNCHANGED} Open the composition this plan names${named} and apply again.`);
}

function payloadFailure(failure: ReadFailure): PreApplyFailure | null {
  if (failure.code !== "PAYLOAD_LIMIT") return null;
  const { bytes, limit } = failure.details;
  const size = bytes !== undefined && limit !== undefined ? ` (${bytes} of ${limit} bytes)` : "";
  return final(failure.code, `The read before applying exceeded its byte budget${size}, so it could not confirm the project is still the one this plan was prepared against. Nothing was run. Refresh the project, then propose the plan again.`);
}

function probeFailure(failure: ReadFailure, attempt: number): PreApplyFailure | null {
  const { code, said } = failure;
  if (code === "UNSUPPORTED_HOST") return final(code, `This build of After Effects is outside the range the project read supports, so nothing could be read before applying.${said ? ` It said: ${said}` : ""}${UNCHANGED}`);
  if (code === "PROBE_FAILED") return retryable(code, `The After Effects probe failed before applying${said ? `: ${said}` : ""}${UNCHANGED}${IDLE}`);
  if (code !== "HOST_READ_FAILED") return null;
  return retryable(code, `After Effects did not answer the read before applying${attempt > 1 ? ` (attempt ${attempt})` : ""}${said ? `. It said: ${said}` : ""}${UNCHANGED}${IDLE}`);
}

/** The refusal to show when the read taken before an apply failed, or null when it succeeded. */
export function preApplyReadFailure(raw: string | null, parsed: HostSnapshot | null, attempt: number, compositionId: string | null): PreApplyFailure | null {
  if (parsed && parsed.ok === true) return null;
  const failure = readFailure(raw, parsed);
  const known = projectFailure(failure.code, compositionId) ?? payloadFailure(failure) ?? probeFailure(failure, attempt);
  if (known) return known;
  return final(failure.code, `${failure.code} from After Effects before applying${failure.said ? `: ${failure.said}` : ""}${UNCHANGED} Refresh and propose the plan again.`);
}
