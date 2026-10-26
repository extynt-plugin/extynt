// The host error an apply, an undo or a capture reports, cut down to a code and a message safe to hand an agent.
import { ENGLISH_FAILURE_TEXT } from "./failure-english.js";
import type { Translate } from "@extynt/ui-text";
import { decode, fallback, type JsonValue, object, string } from "@extynt/decode";


const hostError = object({ code: fallback(string(), undefined), message: fallback(string(), undefined) });

function codeOf(given: string | undefined): string {
  return given !== undefined && /^[A-Z0-9_]{1,64}$/.test(given) ? given : "HOST_MUTATION_FAILED";
}

function safeMessage(given: string): string {
  return given
    .replace(/(?:bearer|token|api[_-]?key)\s*[:=]?\s*[^\s,;]+/gi, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s,;]+/g, "[path]")
    .slice(0, 256);
}

/** A host error as a code and a message with tokens and home paths removed; undefined when the host sent no object. */
export function boundedHostError(value: JsonValue | undefined, t: Translate = ENGLISH_FAILURE_TEXT): { code: string; message: string } | undefined {
  const read = decode(hostError, value);
  if (!read.ok) return undefined;
  const code = codeOf(read.value.code);
  if (read.value.message === undefined) return { code, message: t("failure.host.applyFailed") };
  return { code, message: safeMessage(read.value.message) || t("failure.host.applyFailed") };
}
