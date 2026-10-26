// The sidecar's version, and the names other modules import from the protocol module, now served by the modules that own them.

/** The sidecar's version. */
export const SIDECAR_VERSION = "0.1.0";

export { SNAPSHOT_SCHEMA_VERSION } from "./server-limits.js";
export { appliedCreatedBindings } from "./server-created-bindings.js";
