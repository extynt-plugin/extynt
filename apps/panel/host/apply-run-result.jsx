/* Apply result: the success and failure JSON of aeApplyPlan and the error codes a failure may report. */
/* global aeApplyMetadataGuard, aeApplyRequest, aeApplyRestoreSelection, aeApplyRestoreSelectionGrouped, aeApplyRollBack, aeCollectionSameStamp, aeHasOwn */
/* exported aeApplyFailure, aeApplySuccessJson */
var AE_APPLY_KNOWN_CODES = {
    READBACK_MISMATCH: true, READBACK_STALE: true, STALE_READ_SET: true, INVALID_COMMAND: true, RENDER_EXECUTION_FAILED: true,
      RENDER_SETTINGS_REFUSED: true, MEDIA_ENCODER_NOT_INSTALLED: true, MEDIA_ENCODER_FAILED: true, MEDIA_ENCODER_UNSUPPORTED: true,
      PROJECT_CLEANUP_FAILED: true, PROJECT_CLEANUP_UNSUPPORTED: true,
    PARENT_CYCLE: true, INVALID_TARGET: true, TARGET_NOT_FOUND: true, TARGET_LOCKED: true, EFFECT_NOT_AVAILABLE: true, EFFECT_DIALOG_CANCELLED: true,
    EFFECT_STATE_WRITE_FAILED: true, PROPERTY_NOT_FOUND: true, PROPERTY_NOT_SETTABLE: true, PROPERTY_NOT_ANIMATABLE: true, PROPERTY_WRITE_FAILED: true,
    TIMING_WRITE_FAILED: true, AUDIO_WRITE_FAILED: true, COMPOSITION_WRITE_FAILED: true, MARKER_WRITE_FAILED: true, MARKERS_UNSUPPORTED: true,
    MARKER_EXISTS: true, MARKER_NOT_FOUND: true, THREED_OPTIONS_UNSUPPORTED: true, CREATE_LAYER_UNSUPPORTED: true, DUPLICATE_LAYER_UNSUPPORTED: true,
    DUPLICATE_LAYER_FAILED: true, REMOVE_LAYER_UNSUPPORTED: true, REMOVE_LAYER_FAILED: true, REMOVE_ITEM_UNSUPPORTED: true, REMOVE_ITEM_FAILED: true,
    ITEM_REFERENCED_EARLIER: true, MASK_REMOVED_EARLIER: true, REMOVE_MASK_FAILED: true, MASK_UNSUPPORTED: true, REORDER_LAYER_UNSUPPORTED: true,
    TRACK_MATTE_UNSUPPORTED: true, DESTRUCTIVE_CONFIRMATION_REQUIRED: true, CREATE_COMPOSITION_UNSUPPORTED: true, CREATE_FOLDER_UNSUPPORTED: true,
      IMPORT_FILE_NOT_FOUND: true,
    INVALID_IMPORT_TYPE: true, IMPORT_UNSUPPORTED: true, IMPORT_FAILED: true, SVG_UNSAFE: true, SVG_IMPORT_UNSUPPORTED: true,
    SVG_IMPORT_FAILED: true, SVG_NATIVE_SHAPES_NOT_CREATED: true, MANAGED_SVG_PATH_UNSAFE: true, MANAGED_SVG_WRITE_FAILED: true, MANAGED_SVG_COLLISION: true,
    FOLDER_CYCLE: true, UNSUPPORTED_OPERATION: true, BOUNDS_EXCEEDED: true, INVALID_VALUE: true, KEYFRAME_WRITE_FAILED: true,
    CONFLICTING_KEYS: true, SPATIAL_UNSUPPORTED: true, EXPRESSIONS_UNSUPPORTED: true, SEPARATED_DIMENSIONS_UNSUPPORTED: true,
      SEPARATED_POSITION_VALUE_INVALID: true,
    SEPARATED_POSITION_FOLLOWER_MISSING: true, TEXT_ANIMATOR_PROPERTY_HIDDEN: true, TEXT_ANIMATOR_NOT_CONFIRMED: true, EASING_UNSUPPORTED: true,
      INVALID_OPERATION: true,
    TEXT_BOX_ONLY: true, TEXT_RANGE_OUT_OF_BOUNDS: true, TEXT_DOCUMENT_UNSUPPORTED: true, TEXT_ANIMATOR_UNSUPPORTED: true, PRESET_NOT_FOUND: true,
    PRESET_APPLY_FAILED: true, LAYER_STYLES_UNSUPPORTED: true, LAYER_STYLE_NOT_ADDED: true, LAYER_STYLE_WRITE_FAILED: true, VIEWER_UNAVAILABLE: true,
    SHAPE_UNSUPPORTED: true, SHAPE_ITEM_UNSUPPORTED: true, TIME_REMAP_UNSUPPORTED: true, EXPRESSION_WRITE_FAILED: true, EXPRESSION_INVALID: true,
    PRECOMPOSE_UNSUPPORTED: true, PRECOMPOSE_FAILED: true, ESSENTIAL_GRAPHICS_UNSUPPORTED: true, MOGRT_EXPORT_FAILED: true,
      MOGRT_PROJECT_UNSAVED: true, GUIDES_UNSUPPORTED: true,
    PROJECT_SETTINGS_UNSUPPORTED: true, LAYER_SWITCH_UNSUPPORTED: true, KEYFRAME_READ_FAILED: true, PRESET_SAVE_FAILED: true,
      PRESET_SAVE_UNSUPPORTED: true, PROJECT_UNSAVED_CHANGES: true, PROJECT_OPEN_FAILED: true, COLLECT_FAILED: true, TRACKER_DATA_MISSING: true,
      TRACKER_IGNORES_EFFECTS: true, SOLID_SHARED: true, PROJECT_UNSAVED: true, PROJECT_SAVE_EXISTS: true, PROJECT_SAVE_FAILED: true,
      PUPPET_PRESET_MISSING: true, PUPPET_PRESET_FAILED: true, PUPPET_PIN_COUNT: true, PUPPET_LAYER_UNSUPPORTED: true, PUPPET_PINS_UNWRITABLE: true,
      PUPPET_PIN_NOT_PLACED: true, BRIDGE_MISSING: true, BRIDGE_REFUSED: true, BRIDGE_NO_ANSWER: true, FRAME_EXPORT_UNSUPPORTED: true,
      FRAME_EXPORT_FAILED: true, KEY_NOT_FOUND: true, KEY_TIME_COLLISION: true, EFFECT_NOT_FOUND: true, EFFECT_REMOVE_FAILED: true, EFFECT_REORDER_FAILED: true,
    FOOTAGE_TARGET_REQUIRED: true, FOOTAGE_SOURCE_UNSUPPORTED: true, FOOTAGE_STILL_INTERPRETATION: true, ALPHA_MODE_UNAVAILABLE: true,
      INTERPRETATION_WRITE_FAILED: true,
    INTERPRETATION_READBACK_MISMATCH: true, SCENE_EDIT_UNSUPPORTED: true, SCENE_EDIT_TIME_REMAPPED: true, SCENE_EDIT_NOT_VIDEO: true, SCENE_EDIT_FAILED: true,
    FOOTAGE_FILE_NOT_FOUND: true, FOOTAGE_REPLACE_FAILED: true, FOOTAGE_PROXY_FAILED: true, FOOTAGE_UNSUPPORTED: true,
      DUPLICATE_COMPOSITION_FAILED: true, DUPLICATE_COMPOSITION_UNSUPPORTED: true,
    RENDER_QUEUE_UNSUPPORTED: true, RENDER_TEMPLATE_UNSUPPORTED: true, RENDER_OUTPUT_UNSUPPORTED: true, RENDER_CONFIG_FAILED: true,
      DERIVE_COMMAND_FAILED: true, DERIVE_COMMAND_UNAVAILABLE: true,
    AMBIGUOUS_LAYER_NAME: true, EXPRESSION_ERROR: true
};
var AE_APPLY_IMPORT_CODES = { IMPORT_FILE_NOT_FOUND: true, INVALID_IMPORT_TYPE: true, IMPORT_UNSUPPORTED: true, IMPORT_FAILED: true };
var AE_APPLY_PRE_WRITE_CODES = { TEXT_BOX_ONLY: true, TEXT_RANGE_OUT_OF_BOUNDS: true, MARKER_EXISTS: true, MARKER_NOT_FOUND: true,
  PRESET_NOT_FOUND: true, LAYER_STYLES_UNSUPPORTED: true, VIEWER_UNAVAILABLE: true, MOGRT_PROJECT_UNSAVED: true, PROJECT_UNSAVED_CHANGES: true,
  TRACKER_IGNORES_EFFECTS: true, TRACKER_DATA_MISSING: true, SOLID_SHARED: true, PROJECT_UNSAVED: true, PROJECT_SAVE_EXISTS: true, KEY_NOT_FOUND: true,
  KEY_TIME_COLLISION: true, EFFECT_NOT_FOUND: true };
/** Success reply for a plan. Returns JSON
 * {ok:true,operation:"apply_plan",planId,metadataReadback,frameChecks,appliedOperations,steps,managedSources,rollback,...}. */
function aeApplySuccessJson(run, metadataReadback, frameChecks) {
    var request = aeApplyRequest, managedSources = run.managedSources;
    var rollback = managedSources.length ? "After Effects Undo restores the project; retained managed SVG files remain on disk" : "After Effects Undo";
    return JSON.stringify({ ok: true, operation: "apply_plan", planId: request.planId, metadataReadback: metadataReadback, frameChecks: (frameChecks
      && frameChecks.length) ? frameChecks : undefined, appliedOperations: run.touched, steps: run.steps, managedSources: managedSources,
      externalOutputs: run.externalOutputs, partial: false, readOnly: run.readOnly === true ? true : undefined, undoGroup: request.undoGroup,
      undoGroups: run.undoGroups, changedUndoGroups: run.changedGroups, batchSize: run.batchSize, receipt: { planId: request.planId,
      status: "executed", postcondition: "pending_refresh", mayHaveMutated: run.readOnly === true ? false : undefined,
      mutationState: run.readOnly === true ? "not-applied" : undefined, undoGroup: request.undoGroup, undoGroups: run.undoGroups,
      changedUndoGroups: run.changedGroups, batchSize: run.batchSize, appliedOperations: run.touched, steps: run.steps, managedSources: managedSources,
      externalOutputs: run.externalOutputs, rollback: rollback } });
}
function aeApplyFailureInfo(error) {
    var message = String((error && error.message) ? error.message : error), code = message.split(":")[0];
    if (!aeHasOwn(AE_APPLY_KNOWN_CODES, code)) code = "HOST_MUTATION_FAILED";
    if (aeHasOwn(AE_APPLY_IMPORT_CODES, code)) message = "Import request could not be completed.";
    return { code: code, message: message };
}
function aeApplyProjectUntouched(run) {
    if (run.touched.length > 0 || !run.startStamp || run.startStamp.revision === null) return false;
    try { return aeCollectionSameStamp(run.startStamp); } catch (ignoredStamp) { return false; }
}
var AE_APPLY_READBACK_CODES = { READBACK_MISMATCH: true, READBACK_STALE: true, INTERPRETATION_READBACK_MISMATCH: true };
function aeApplyMayHaveMutated(run, code) {
    if (run.managedSources.length > 0 || run.externalOutputs.length > 0) return true;
    return run.undoStarted && !(run.touched.length === 0 && AE_APPLY_PRE_WRITE_CODES[code] === true) && !aeApplyProjectUntouched(run);
}
function aeApplyMutationState(run, mayHaveMutated) {
    if (!mayHaveMutated) return "not-applied";
    if (run.touched.length > 0) return "partial-applied";
    return (run.managedSources.length > 0 || run.externalOutputs.length > 0) ? "external-file-written" : "mutation-unknown";
}
function aeApplyFailedOperation(run) { return (run.currentIndex >= 0
  && aeApplyRequest.operations[run.currentIndex]) ? String(aeApplyRequest.operations[run.currentIndex].operation) : null; }
function aeApplyFailureRollback(run, mayHaveMutated, rolledBack) {
    if (rolledBack) return "Rolled back: the batch's undo steps were undone and the project reads as before it";
    if (run.managedSources.length) return "Managed SVG file remains; After Effects Undo can only restore project mutations";
    if (run.externalOutputs.length) return "External files written remain on disk; After Effects Undo can only restore project mutations";
    return mayHaveMutated ? "After Effects Undo required" : "none";
}
function aeApplyFailureReceipt(run, outcome) {
    var request = aeApplyRequest;
    return { planId: request.planId, status: "rejected", externalOutputs: run.externalOutputs,
      postcondition: outcome.mayHaveMutated ? "partial_mutation_possible" : "not_run", undoGroup: request.undoGroup, undoGroups: run.openedUndoGroups,
      changedUndoGroups: run.changedGroups, closedUndoGroups: run.closedUndoGroups, batchSize: run.batchSize, appliedOperations: [],
      completedOperations: outcome.rolledBack ? [] : run.touched, steps: run.steps, managedSources: run.managedSources,
      partial: outcome.mayHaveMutated, mayHaveMutated: outcome.mayHaveMutated, mutationState: outcome.mutationState,
      rollback: aeApplyFailureRollback(run, outcome.mayHaveMutated, outcome.rolledBack === true) };
}
function aeApplyFailureJson(run, failure, outcome) {
    var request = aeApplyRequest, failedOperation = aeApplyFailedOperation(run);
    var creationEvidence = (aeApplyMetadataGuard && aeApplyMetadataGuard.creation) ? aeApplyMetadataGuard.progress : null;
    return JSON.stringify({ ok: false, operation: "apply_plan", planId: request.planId, appliedOperations: [],
      completedOperations: outcome.rolledBack ? [] : run.touched, externalOutputs: run.externalOutputs, rolledBack: outcome.rolledBack === true,
      rolledBackOperations: outcome.rolledBack ? run.touched : undefined, steps: run.steps, managedSources: run.managedSources,
      partial: outcome.mayHaveMutated, mayHaveMutated: outcome.mayHaveMutated, mutationState: outcome.mutationState,
      creationEvidence: creationEvidence, phase: run.phase, failedOperationIndex: run.currentIndex, failedOperation: failedOperation,
      laterOperationsAttempted: false, error: { code: failure.code, message: failure.message.slice(0, 256), operationIndex: run.currentIndex,
      operation: failedOperation }, undoGroup: request.undoGroup, undoGroups: run.openedUndoGroups, changedUndoGroups: run.changedGroups,
      closedUndoGroups: run.closedUndoGroups, batchSize: run.batchSize, receipt: aeApplyFailureReceipt(run, outcome) });
}
/**
 * Failure reply for a plan, rolling the batch back when it is safe to. Returns the aeApplyFailureJson JSON {ok:false,o
 * peration:"apply_plan",planId,completedOperations,rolledBack,steps,mayHaveMutated,mutationState,error,...}. A batch
 * that wrote and then failed is taken back whole, and only a proven rollback lets the sidecar treat it as never run; a
 * failed read-back is not provable as taken back, since the project shape cannot see property values. A failure before
 * the first write that leaves the project revision unchanged records no undo step.
 */
function aeApplyFailure(run, error) {
    var failure = aeApplyFailureInfo(error);
    if (!run.undoStarted) aeApplyRestoreSelection();
    var mayHaveMutated = aeApplyMayHaveMutated(run, failure.code);
    var rolledBack = mayHaveMutated && run.phase === "apply" && AE_APPLY_READBACK_CODES[failure.code] !== true && aeApplyRollBack(run);
    if (rolledBack) { aeApplyRestoreSelectionGrouped(); return aeApplyFailureJson(run, failure, { mayHaveMutated: false, mutationState: "rolled-back",
      rolledBack: true }); }
    return aeApplyFailureJson(run, failure, { mayHaveMutated: mayHaveMutated, mutationState: aeApplyMutationState(run, mayHaveMutated) });
}
