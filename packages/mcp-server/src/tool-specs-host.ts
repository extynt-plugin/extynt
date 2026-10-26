// The tools that describe what this After Effects host can do: capabilities, effect controls, fonts and profiles.
import { arrayArg, booleanArg, enumArg, numberArg, optionalArg, stringArg } from "./arg.js";
import { MAX_FONT_RESULTS } from "@extynt/capability-catalogue";
import { HOST_PROFILE_AVAILABILITY, HOST_PROFILE_EVIDENCE, HOST_PROFILE_KINDS, HOST_PROFILE_OPERATION_STATUS } from "./core-constants.js";
import { defineTool } from "./tool.js";
import type { ToolEntry } from "./tool.js";

export const AE_LIST_CAPABILITIES = defineTool("ae_list_capabilities", {
  description: "The bundled extynt catalogue: what these effects are and what they control, as shipped knowledge. Not evidence that an effect exists on this machine - ask ae_search_host_capabilities that.",
  input: {
    limit: optionalArg(numberArg()),
  },
});

export const AE_SEARCH_CAPABILITIES = defineTool("ae_search_capabilities", {
  description: "Search the bundled extynt catalogue for what an effect is and roughly controls. For what THIS After Effects can actually add, search ae_search_host_capabilities instead; that list is authoritative.",
  input: {
    query: optionalArg(stringArg()),
    limit: optionalArg(numberArg()),
  },
});

export const AE_DESCRIBE_CAPABILITY = defineTool("ae_describe_capability", {
  description: "Bundled catalogue details for one capability. Background on the effect; ae_describe_host_capability detail=controls is the authority for this machine's control paths and ranges.",
  input: {
    id: optionalArg(stringArg()),
  },
});

export const AE_GET_EFFECT_CONTROLS = defineTool("ae_get_effect_controls", {
  description: "Controls observed on instances of effect matchName that are already on layers in this project - evidence from the project, not a promise about the effect in general.",
  input: {
    matchName: optionalArg(stringArg()),
    limit: optionalArg(numberArg()),
  },
});

export const AE_GET_INVENTORY_DIFF = defineTool("ae_get_inventory_diff", {
  description: "Installed-effect inventory counts and change since last scan.",
  input: {},
});

export const AE_GET_HOST_PROFILE_SUMMARY = defineTool("ae_get_host_profile_summary", {
  description: "Cached host capability profile summary (truncated scans are not proof of absence).",
  input: {
    knownProfileId: optionalArg(stringArg()),
  },
});

export const AE_SEARCH_HOST_CAPABILITIES = defineTool("ae_search_host_capabilities", {
  description: "What this After Effects actually has: search installed effects and Animation Presets (compact rows), authoritative over every other list here. Effect ids feed ensure_effect (capabilityId) and describe detail=controls gives control paths, ranges, and menus for set_effect_control/animate_control; preset ids feed apply_preset. Among equally relevant effects the user's most-used come first, and a row may carry used (their use count): a tie-breaker, never a reason to pick an effect that does not fit.",
  input: {
    query: optionalArg(stringArg()),
    kinds: optionalArg(arrayArg(enumArg(HOST_PROFILE_KINDS))),
    availability: optionalArg(arrayArg(enumArg(HOST_PROFILE_AVAILABILITY))),
    operationStatus: optionalArg(arrayArg(enumArg(HOST_PROFILE_OPERATION_STATUS))),
    evidence: optionalArg(arrayArg(enumArg(HOST_PROFILE_EVIDENCE))),
    knownProfileId: optionalArg(stringArg()),
    limit: optionalArg(numberArg({ min: 1, max: 50 })),
    cursor: optionalArg(stringArg()),
  },
});

export const AE_DESCRIBE_HOST_CAPABILITY = defineTool("ae_describe_host_capability", {
  description: "One host capability; detail=controls|usage|evidence pages the heavy parts.",
  input: {
    id: stringArg(),
    detail: optionalArg(enumArg(["summary", "controls", "usage", "evidence"])),
    limit: optionalArg(numberArg({ min: 1, max: 50 })),
    cursor: optionalArg(stringArg()),
    profileId: optionalArg(stringArg()),
  },
});

export const AE_GET_HOST_PROFILE_STATUS = defineTool("ae_get_host_profile_status", {
  description: "Profile cache state and pending probes.",
  input: {
    knownProfileId: optionalArg(stringArg()),
  },
});

export const AE_SEARCH_FONTS = defineTool("ae_search_fonts", {
  description: "Search the fonts installed on this host (compact rows, bounded). postScriptName is the exact value set_text_document's font field takes; never name a font this host does not list, and a partial census is not proof a font is absent.",
  input: {
    query: optionalArg(stringArg()),
    limit: optionalArg(numberArg({ min: 1, max: MAX_FONT_RESULTS })),
    cursor: optionalArg(stringArg()),
    knownProfileId: optionalArg(stringArg()),
  },
});

export const AE_GET_FRESH_EDIT_CONTEXT = defineTool("ae_get_fresh_edit_context", {
  description: "Selection and freshness identity for an edit.",
  input: {},
});

export const AE_RESOLVE_CAPABILITY = defineTool("ae_resolve_capability", {
  description: "Turn a semantic role (blur.amount, transform.position) into the exact control path observed on a layer.",
  input: {
    capabilityId: stringArg({ minLength: 1, maxLength: 128 }),
    role: optionalArg(enumArg(["blur.amount", "blur.repeat-edges", "transform.position"])),
    compositionId: optionalArg(stringArg({ maxLength: 128 })),
    layerId: optionalArg(stringArg({ maxLength: 128 })),
    selectedLayer: optionalArg(booleanArg()),
    effectPath: optionalArg(stringArg({ maxLength: 512 })),
  },
});

/** The tools that describe what this After Effects host can do: capabilities, effect controls, fonts and profiles. */
export const HOST_TOOLS = [
  AE_LIST_CAPABILITIES,
  AE_SEARCH_CAPABILITIES,
  AE_DESCRIBE_CAPABILITY,
  AE_GET_EFFECT_CONTROLS,
  AE_GET_INVENTORY_DIFF,
  AE_GET_HOST_PROFILE_SUMMARY,
  AE_SEARCH_HOST_CAPABILITIES,
  AE_DESCRIBE_HOST_CAPABILITY,
  AE_GET_HOST_PROFILE_STATUS,
  AE_SEARCH_FONTS,
  AE_GET_FRESH_EDIT_CONTEXT,
  AE_RESOLVE_CAPABILITY,
] satisfies ReadonlyArray<ToolEntry>;
