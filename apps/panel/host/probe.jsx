/* Entry file of the After Effects host scripts: the native plugin loads this one file, which loads the parts beside
 * it, then the collection and catalogue adapters. Every $.evalFile is a top-level statement, and a part that throws
 * while loading leaves its reason for the panel's host-script check to report.
 */
var aeHostLoadErrors = [];
function aeHostLoadFailed(name, loadError) {
    try { aeHostLoadErrors.push((name + ": " + String(loadError) + " (line " + loadError.line + ")").slice(0, 300)); } catch (ignoredRecord) {}
}
if (typeof $ !== "undefined" && typeof File !== "undefined" && $.fileName) {
    var aeHostDirectory = File($.fileName).parent.fsName;
    try { $.evalFile(new File(aeHostDirectory + "/host-shared.jsx")); } catch (loadError) { aeHostLoadFailed("host-shared.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/read-core.jsx")); } catch (loadError) { aeHostLoadFailed("read-core.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/read-properties.jsx")); } catch (loadError) { aeHostLoadFailed("read-properties.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/read-layers.jsx")); } catch (loadError) { aeHostLoadFailed("read-layers.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/read-project.jsx")); } catch (loadError) { aeHostLoadFailed("read-project.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/read-details.jsx")); } catch (loadError) { aeHostLoadFailed("read-details.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/census.jsx")); } catch (loadError) { aeHostLoadFailed("census.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/edit-adapters.jsx")); } catch (loadError) { aeHostLoadFailed("edit-adapters.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-breadcrumb.jsx")); } catch (loadError) { aeHostLoadFailed("apply-breadcrumb.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-shared.jsx")); } catch (loadError) { aeHostLoadFailed("apply-shared.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-keys.jsx")); } catch (loadError) { aeHostLoadFailed("apply-keys.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-layers.jsx")); } catch (loadError) { aeHostLoadFailed("apply-layers.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-masks.jsx")); } catch (loadError) { aeHostLoadFailed("apply-masks.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-shapes.jsx")); } catch (loadError) { aeHostLoadFailed("apply-shapes.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-readback.jsx")); } catch (loadError) { aeHostLoadFailed("apply-readback.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-effects.jsx")); } catch (loadError) { aeHostLoadFailed("apply-effects.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-text.jsx")); } catch (loadError) { aeHostLoadFailed("apply-text.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-expressions.jsx")); } catch (loadError) { aeHostLoadFailed("apply-expressions.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-animators.jsx")); } catch (loadError) { aeHostLoadFailed("apply-animators.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-output.jsx")); } catch (loadError) { aeHostLoadFailed("apply-output.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-validate.jsx")); } catch (loadError) { aeHostLoadFailed("apply-validate.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-validate-rules.jsx")); } catch (loadError) { aeHostLoadFailed("apply-validate-rules.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-project.jsx")); } catch (loadError) { aeHostLoadFailed("apply-project.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-assets.jsx")); } catch (loadError) { aeHostLoadFailed("apply-assets.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-footage.jsx")); } catch (loadError) { aeHostLoadFailed("apply-footage.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-svg-fallback.jsx")); } catch (loadError) { aeHostLoadFailed("apply-svg-fallback.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-flow.jsx")); } catch (loadError) { aeHostLoadFailed("apply-flow.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-preflight.jsx")); } catch (loadError) { aeHostLoadFailed("apply-preflight.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-steps-project.jsx")); } catch (loadError) { aeHostLoadFailed("apply-steps-project.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-steps-layers.jsx")); } catch (loadError) { aeHostLoadFailed("apply-steps-layers.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-derive.jsx")); } catch (loadError) { aeHostLoadFailed("apply-derive.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-camera.jsx")); } catch (loadError) { aeHostLoadFailed("apply-camera.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-key-edit.jsx")); } catch (loadError) { aeHostLoadFailed("apply-key-edit.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-effect-edit.jsx")); } catch (loadError) { aeHostLoadFailed("apply-effect-edit.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-bridge.jsx")); } catch (loadError) { aeHostLoadFailed("apply-bridge.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-puppet.jsx")); } catch (loadError) { aeHostLoadFailed("apply-puppet.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-layer-more.jsx")); } catch (loadError) { aeHostLoadFailed("apply-layer-more.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-misc.jsx")); } catch (loadError) { aeHostLoadFailed("apply-misc.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-steps-effects.jsx")); } catch (loadError) { aeHostLoadFailed("apply-steps-effects.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-frame.jsx")); } catch (loadError) { aeHostLoadFailed("apply-frame.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/apply-run-result.jsx")); } catch (loadError) { aeHostLoadFailed("apply-run-result.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/evidence.jsx")); } catch (loadError) { aeHostLoadFailed("evidence.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/preview.jsx")); } catch (loadError) { aeHostLoadFailed("preview.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/bridge.jsx")); } catch (loadError) { aeHostLoadFailed("bridge.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/collection.jsx")); } catch (loadError) { aeHostLoadFailed("collection.jsx", loadError); }
    try { $.evalFile(new File(aeHostDirectory + "/catalogue.jsx")); } catch (loadError) { aeHostLoadFailed("catalogue.jsx", loadError); }
}
