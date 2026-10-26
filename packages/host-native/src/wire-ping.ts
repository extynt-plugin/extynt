// Decoder and type for the `ping_direct` reply, which the control connection answers off the main thread.
import { literal, number, object, string } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";
import { pluginHostIdentity } from "./host-identity.js";
import type { HostIdentity } from "./host-identity.js";
import { absentAsNull, nullUnlessValid } from "./wire-common.js";

const waitingOnDialog = object({ title: string(), sinceMs: number() });

/** An After Effects dialog that is open while a call runs; `sinceMs` is how long it has been up. */
export type WaitingOnDialog = Infer<typeof waitingOnDialog>;

const pingDirectFields = object({
  pong: literal(true), mainThread: literal(false), pluginVersion: string(), aeVersion: string(), pid: number(),
  host: nullUnlessValid<HostIdentity>(pluginHostIdentity), arch: string(),
  idleAgeMs: absentAsNull(number()), idleTicks: number(), queueDepth: number(), oldestQueuedMs: absentAsNull(number()), watchers: number(),
  waitingOnDialog: nullUnlessValid(waitingOnDialog),
  library: object({ version: absentAsNull(string()), entryFile: absentAsNull(string()) }),
});

/** The decoded `ping_direct` reply; callers that build one by hand may leave `waitingOnDialog` out. */
export type PingDirectResult = Omit<Infer<typeof pingDirectFields>, "waitingOnDialog"> & { readonly waitingOnDialog?: WaitingOnDialog | null };

/**
 * Decodes the `ping_direct` reply. `host` and `waitingOnDialog` are null when the plugin omits them or sends them malformed, so a plugin that predates
 * either field still pairs (the sidecar then derives a host identity from `aeVersion`).
 */
export const pingDirectResult: Decoder<PingDirectResult> = pingDirectFields;
