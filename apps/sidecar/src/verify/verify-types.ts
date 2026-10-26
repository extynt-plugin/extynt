// The one operation shape callers outside verification share: a plan operation row that names its kind.

import type { JsonObject } from "@extynt/decode";

/** One authored plan operation; the verifiers decode the fields they read from it. */
export type PlanOperation = JsonObject & { readonly operation: string };
