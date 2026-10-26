// The constants every MCP tool module shares: the approval and undo bounds, the
// expression-card widths, the path policy's tables, and the host-profile vocabularies.

// The operation queue the in-panel agent fills, so no id ever reaches the model: the sidecar owns the plan.
// Every QUEUE_CHECKPOINT_SIZE operations the queue reports back; this is deliberately NOT the undo-group size.
export const EXPRESSION_CARD_SOURCE_CHARS = 240;
export const EXPRESSION_PRESENTATION_SOURCE_CHARS = 400;

export const PATH_FIELD_USES: Readonly<Record<string, { field: "path" | "outputPath" | "destinationFolder"; use: "destination" | "source"; label: string; optional?: boolean }>> = {
  import_file: { field: "path", use: "source", label: "import source" },
  replace_footage: { field: "path", use: "source", label: "replacement footage" },
  set_footage_proxy: { field: "path", use: "source", label: "proxy source" },
  render_composition: { field: "outputPath", use: "destination", label: "render destination" },
  export_mogrt: { field: "outputPath", use: "destination", label: "export destination" },
  save_layer_preset: { field: "outputPath", use: "destination", label: "preset destination" },
  switch_project: { field: "path", use: "source", label: "project to open", optional: true },
  collect_project: { field: "destinationFolder", use: "destination", label: "collect destination" },
  save_project: { field: "path", use: "destination", label: "project save destination", optional: true },
  export_frame: { field: "outputPath", use: "destination", label: "frame export destination" },
};
export const DENIED_PATH_ROOTS = ["/etc", "/private/etc", "/usr", "/bin", "/sbin", "/System", "/Library", "/var", "/private/var", "/dev", "/proc", "/sys", "/boot", "/Applications", "/cores"];
export const HARNESS_OUTPUT_PLACEHOLDER = "/EXTYNT_OUT_DIR";

export const AGENT_APPROVAL_TTL_MS = 600_000;
/** Above this, a single apply holds After Effects long enough that staging into verified steps is safer. */
export const PROPOSAL_OPERATION_LIMIT = 256;

export const HOST_PROFILE_KINDS = ["effect", "preset", "command", "importer", "codec", "renderer", "panel", "script", "utility", "native"] as const;
export const HOST_PROFILE_AVAILABILITY = ["available", "unavailable", "unknown"] as const;
export const HOST_PROFILE_OPERATION_STATUS = ["supported", "read-only", "probeNeeded", "unsupported", "unknown"] as const;
export const HOST_PROFILE_EVIDENCE = ["documented", "curated", "installed", "observed", "probed", "inferred", "unsupported", "unknown"] as const;

export const CREATED_LAYER_TYPES: Record<string, string> = { text: "text", shape: "shape", null: "null", camera: "camera", light: "light", adjustment: "adjustment", solid: "av", footage: "av" };
export const LAYER_TYPES = new Set(["av", "text", "shape", "camera", "light", "null", "adjustment"]);
