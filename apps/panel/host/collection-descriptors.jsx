/* Property descriptor helpers shared by the detail and value pages and the local-control reads: read-only, every read guarded. */
/* exported aeCollectionDescriptorTypes, aeCollectionEffectContext, aeCollectionNativeState */
function aeCollectionEnumName(value, enumeration) {
    for (var key in enumeration) {
        if (enumeration.hasOwnProperty(key)) {
            if (value === enumeration[key]) return key;
        }
    }
    return "unknown";
}
function aeCollectionOptionalField(property, field) {
    try { var value = property[field]; return (typeof value === "boolean" || (typeof value === "number" && isFinite(value))) ? value : null; }
    catch (ignored) { return null; }
}
function aeCollectionOptionalText(property, field) {
    try { var value = property[field]; return (typeof value === "string" && value.length <= 4096) ? value : null; }
    catch (ignored) { return null; }
}
/** Native property state. Returns {unitsText,keyframeCount,isTimeVarying,expressionEnabled,expressionPresent,canSetValue}, each null when unreadable. */
function aeCollectionNativeState(property) {
    var expressionPresent = null, canSetValue = null;
    try { if (typeof property.expression === "string") expressionPresent = property.expression.length > 0; } catch (ignored) {}
    try { canSetValue = typeof property.setValue === "function"; } catch (ignored) {}
    return { unitsText: aeCollectionOptionalText(property, "unitsText"), keyframeCount: aeCollectionOptionalField(property, "numKeys"),
        isTimeVarying: aeCollectionOptionalField(property, "isTimeVarying"), expressionEnabled: aeCollectionOptionalField(property, "expressionEnabled"),
        expressionPresent: expressionPresent, canSetValue: canSetValue };
}
/** Effect context of a property row. Returns
 * {effectIndex,effectMatchName,effectName,effectEnabled,propertyIndices,relativeIndices,relativeMatchNames,effectPath,relativePath}, or null outside an
 * effect. */
function aeCollectionEffectContext(frame, property, indices, path) {
    var context = frame.effectContext;
    if (String(frame.group.matchName) === "ADBE Effect Parade") {
        return { effectIndex: indices[indices.length - 1], effectMatchName: String(property.matchName), effectName: String(property.name),
            effectEnabled: aeCollectionOptionalField(property, "enabled"), propertyIndices: indices, relativeIndices: [], relativeMatchNames: [],
              effectPath: path, relativePath: "" };
    }
    if (!context) return null;
    return { effectIndex: context.effectIndex, effectMatchName: context.effectMatchName, effectName: context.effectName, effectEnabled: context.effectEnabled,
        propertyIndices: context.propertyIndices, relativeIndices: indices.slice(context.propertyIndices.length),
          relativeMatchNames: frame.relativeMatchNames.concat([String(property.matchName)]), effectPath: context.effectPath,
          relativePath: path.slice(context.effectPath.length + 1) };
}
/** Property type facts. Returns {valueType,propertyType,minimum,maximum,canVaryOverTime,canSetExpression}, each null or "unknown" when unreadable. */
function aeCollectionDescriptorTypes(property) {
    var valueType = "unknown", propertyType = "unknown";
    try { if (typeof PropertyValueType !== "undefined") valueType = aeCollectionEnumName(property.propertyValueType, PropertyValueType); } catch (ignored) {}
    try { if (typeof PropertyType !== "undefined") propertyType = aeCollectionEnumName(property.propertyType, PropertyType); } catch (ignored) {}
    return { valueType: valueType, propertyType: propertyType,
        minimum: aeCollectionOptionalField(property, "hasMin") === true ? aeCollectionOptionalField(property, "minValue") : null,
        maximum: aeCollectionOptionalField(property, "hasMax") === true ? aeCollectionOptionalField(property, "maxValue") : null,
        canVaryOverTime: aeCollectionOptionalField(property, "canVaryOverTime"), canSetExpression: aeCollectionOptionalField(property, "canSetExpression") };
}
