// Version identifiers and hard bounds of the workflow model; every bound that a reducer, store or validator enforces lives here.

export const WORKFLOW_SCHEMA_VERSION = "0.1" as const;
export const WORKFLOW_RESUME_SUPPORTED = false as const;
export const WORKFLOW_ENGINE_ID = "workflow-v1" as const;
export const MAX_WORKFLOW_ID_LENGTH = 128;
export const MAX_WORKFLOW_TITLE_LENGTH = 256;
export const MAX_WORKFLOW_SUMMARY_LENGTH = 1_000;
export const MAX_WORKFLOW_GOAL_LENGTH = 32_000;
export const MAX_WORKFLOW_OPERATIONS_PER_BATCH = 256;
export const MAX_WORKFLOW_DEPENDENCIES_PER_BATCH = 64;
export const MAX_WORKFLOW_EVENT_SIGNATURES = 32_768;
export const MAX_WORKFLOW_JOBS = 64;
export const MAX_WORKFLOW_STAGES_PER_JOB = 128;
export const MAX_WORKFLOW_BATCHES_PER_JOB = 1_024;
/** Sized for one whole film in a single active job (a ~40-layer build is ~1 MB); finished jobs roll off to the archive. */
export const MAX_WORKFLOW_EVENT_LOG_BYTES = 8 * 1_024 * 1_024;
export const MAX_WORKFLOW_EVENT_BYTES = 64 * 1_024;
export const MAX_WORKFLOW_JSON_DEPTH = 16;
export const MAX_WORKFLOW_JSON_NODES = 4_096;
export const MAX_WORKFLOW_STRING_BYTES = 16 * 1_024;
export const MAX_WORKFLOW_ARRAY_ITEMS = 1_024;
export const MAX_WORKFLOW_OBJECT_KEYS = 256;
export const MAX_WORKFLOW_CRITERIA_PER_OWNER = 64;
export const MAX_WORKFLOW_PROVIDER_CYCLES = 1_024;
export const MAX_WORKFLOW_AUTOMATIC_REPAIRS = 2;
export const MAX_WORKFLOW_CONTINUATION_BATCHES = 8;
export const MAX_WORKFLOW_CONTINUATION_BLOCKERS = 32;
export const MAX_WORKFLOW_CONTINUATION_BINDINGS = 64;
export const MAX_WORKFLOW_POSTCONDITIONS = 64;
export const MAX_WORKFLOW_HOST_EVIDENCE = 256;
export const MAX_WORKFLOW_CAPABILITY_FAMILIES = 64;
export const MAX_WORKFLOW_CAPABILITY_SCHEMA_PACKS = 128;
export const MAX_WORKFLOW_CAPABILITY_OPERATIONS = 256;
export const MAX_WORKFLOW_CAPABILITY_FIELDS = 64;
