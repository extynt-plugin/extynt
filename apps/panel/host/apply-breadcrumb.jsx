/* Apply breadcrumb file written before each operation, and dialog suppression around an apply. */
/* exported aeClearApplyBreadcrumb, aeReadApplyBreadcrumb, aeSuppressDialogs, aeWriteApplyBreadcrumb */
var AE_APPLY_BREADCRUMB = "apply-in-flight.json";
function aeApplyBreadcrumbFile(create) { try { var root = new Folder(Folder.userData.fsName + "/extynt"); if (!root.exists && (!create || !root.create())) return null; return new File(root.fsName + "/" + AE_APPLY_BREADCRUMB); } catch (ignoredBreadcrumbPath) { return null; } }
/**
 * Writes the breadcrumb state as JSON to the breadcrumb file. Returns nothing; never throws. Written before every
 * operation and removed when the apply ends either way, so a surviving file names the plan and operation running when
 * After Effects quit or crashed. The probe only reads it; the next apply replaces it.
 */
function aeWriteApplyBreadcrumb(state) { try { var file = aeApplyBreadcrumbFile(true); if (!file) return; file.encoding = "UTF-8"; file.lineFeed = "Unix"; if (!file.open("w")) return; try { file.write(JSON.stringify(state)); } finally { file.close(); } } catch (ignoredBreadcrumbWrite) {} }
/** Deletes the apply breadcrumb file. Returns nothing; never throws. */
function aeClearApplyBreadcrumb() { try { var file = aeApplyBreadcrumbFile(false); if (file && file.exists) file.remove(); } catch (ignoredBreadcrumbClear) {} }
function aeBreadcrumbReadText() {
    var file = aeApplyBreadcrumbFile(false); if (!file || !file.exists) return null;
    file.encoding = "UTF-8"; if (!file.open("r")) return null;
    var text = ""; try { text = file.read(4096); } finally { file.close(); }
    return text;
}
function aeBreadcrumbField(value, key, limit) { return typeof value[key] === "string" ? String(value[key]).slice(0, limit) : null; }
/** The last written breadcrumb {planId,index,operationCount,operation,layerId,...}, or null when absent or unreadable. */
function aeReadApplyBreadcrumb() {
    try {
        var text = aeBreadcrumbReadText(); if (text === null) return null;
        var value = JSON.parse(text);
        if (!value || typeof value.planId !== "string" || typeof value.index !== "number") return null;
        return { planId: String(value.planId).slice(0, 256), index: value.index, operationCount: typeof value.operationCount === "number" ? value.operationCount : null, operation: aeBreadcrumbField(value, "operation", 64), layerId: aeBreadcrumbField(value, "layerId", 128), startedAt: aeBreadcrumbField(value, "startedAt", 64) };
    } catch (ignoredBreadcrumbRead) { return null; }
}
// Script-error and warning dialogs are modal: one raised mid-apply blocks the host until someone clicks it, which reads as a hang.
function aeSuppressDialogs(on) { try { if (on) { if (typeof app.beginSuppressDialogs === "function") app.beginSuppressDialogs(); } else if (typeof app.endSuppressDialogs === "function") app.endSuppressDialogs(false); } catch (ignoredDialogs) {} }
