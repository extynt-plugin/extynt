/** Public surface of @extynt/project-graph: the snapshot model, its fingerprints, and the queries over it. */
export * from "./model.js";
export * from "./fingerprint.js";
export { createFingerprintMemo, freezeDeep, isCurrentFingerprint, isLegacyFingerprint, projectFingerprint, FINGERPRINT_PREFIX, type FingerprintMemo } from "./graph-hash.js";
export * from "./query.js";
export * from "./effects.js";
export * from "./text-document.js";
export * from "./fixtures/representative.js";

export * from "./effect-definitions.js";
