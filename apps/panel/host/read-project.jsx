/* Probe read: installed effects, composition paging and the aeEyesOpenProbe entry point. It sits under the probe in
 * probe.jsx.
 */
/* global AE_PROBE_SCHEMA, aeCollectionStamp, aeFootageInterpretation, aeHasOwn, aeOwnValue, aeProbeBytesOverLimit, aeProbeCompData,
   aeProbeElapsedAtLeast, aeProbeError, aeProbeInteger, aeProbeLimits, aeProbeReadBudget, aeProbeReadItems, aeProbeReadProgress, aeProbeReadProperties,
   aeProbeReadStartedAt, aeProbeRuntime, aeReadApplyBreadcrumb, aeSafe, aeSafeGet */
/* exported aeEyesOpenProbe, aeProbeReadItems, aeProbeReadProgress, aeProbeReadProperties, aeProbeReadStartedAt */
function aeProbeInstalledEffects(config, warnings) {
    var result = [], collection = aeSafe(function () { return app.effects; }, null);
    if (!collection) return { items: result, state: "unknown", truncated: false, totalReported: 0, returnedCount: 0, completeness: "failed" };
    var total = aeSafeGet(collection, "length", 0), limit = Math.min(total, config.maxEffects);
    for (var i = 0; i < limit; i += 1) {
        aeProbeReadBudget(config);
        var effect = aeSafe(function () { return collection[i]; }, null);
        if (!effect) continue;
        var matchName = aeSafe(function () { return String(effect.matchName); }, "");
        if (!matchName) continue;
        result.push({ matchName: matchName, displayName: aeSafe(function () { return String(effect.displayName || effect.name); }, matchName),
          category: aeSafe(function () { return String(effect.category); }, null), version: aeSafe(function () { return String(effect.version); },
          null), available: aeSafe(function () { return effect.isInstalled !== false; }, true) });
    }
    if (total > limit) warnings.push("effect-inventory-limit");
    result.sort(function (a, b) { return a.matchName < b.matchName ? -1 : (a.matchName > b.matchName ? 1 : (a.displayName < b.displayName ? -1 : 1)); });
    return { items: result, state: "enumerable", truncated: total > limit, totalReported: total, returnedCount: result.length,
      completeness: total > limit ? "partial" : "complete" };
}
var AE_PROBE_UNREAD_EFFECTS = { items: [], state: "unknown", truncated: false, totalReported: 0, returnedCount: 0, completeness: "failed" };
function aeProbeWantedIdValid(id) { return typeof id === "string" && id.length >= 1 && id.length <= 128; }
function aeProbeWantedCompositions(ids) {
    if (ids === undefined) return null;
    if (!(ids instanceof Array) || ids.length < 1 || ids.length > 256) return false;
    var wanted = {};
    for (var i = 0; i < ids.length; i += 1) { if (!aeProbeWantedIdValid(ids[i])) return false; wanted[ids[i]] = true; }
    return wanted;
}
function aeProbeCompositionOrder(candidates, activeComp, wanted) {
    var order = [], i;
    for (i = 0; i < candidates.length; i += 1) {
        var id = String(aeSafe(function () { return candidates[i].id; }, ""));
        if (!wanted || aeOwnValue(wanted, id) === true) { if (candidates[i] === activeComp) order.unshift({ item: candidates[i], id: id });
          else order.push({ item: candidates[i], id: id }); }
    }
    return order;
}
function aeProbeCompositionDeferred(meta, data, start) {
    return meta.next > 0 && data.layers.length === 0 && start.layer === 1 && start.property === 0;
}
function aeProbePageSoftPassed(page, softMs) { return page.count > 0 && softMs > 0 && aeProbeElapsedAtLeast(softMs); }
function aeProbeReadOneComposition(entry, page, options) {
    if (!page.stopped && aeProbePageSoftPassed(page, options.softMs)) page.stopped = true;
    if (page.stopped) { page.unread.push(entry.id); return; }
    var own = [], meta = {}, start = aeOwnValue(options.starts, entry.id) || { layer: 1, property: 0 };
    var data = aeProbeCompData(entry.item, { config: options.config, warnings: own, start: start, softMs: options.softMs, meta: meta });
    if (aeProbeCompositionDeferred(meta, data, start)) { page.unread.push(entry.id); page.stopped = true; return; }
    page.read[entry.id] = data; page.count += 1; options.warnings.push.apply(options.warnings, own);
    if (meta.next > 0) { page.partial.push({ id: entry.id, nextLayer: meta.next, nextProperty: meta.nextProperty, layerTotal: meta.total });
      page.stopped = true; }
}
function aeProbeReadCompositions(candidates, options) {
    var order = aeProbeCompositionOrder(candidates, options.activeComp, options.wanted);
    var page = { read: {}, unread: [], partial: [], stopped: false, count: 0 }, compositions = [], i;
    for (i = 0; i < order.length; i += 1) aeProbeReadOneComposition(order[i], page, options);
    for (i = 0; i < candidates.length; i += 1) { var key = String(aeSafe(function () { return candidates[i].id; }, ""));
      var readData = aeOwnValue(page.read, key); if (readData) compositions.push(readData); }
    return { compositions: compositions, unread: page.unread, partial: page.partial };
}
function aeProbeIsRecord(value) { return !!value && typeof value === "object" && !(value instanceof Array); }
function aeProbeStartOf(value) {
    if (typeof value === "number") value = { layer: value, property: 0 };
    if (!aeProbeIsRecord(value)) return null;
    var layer = value.layer, property = value.property === undefined ? 0 : value.property;
    var whole = function (n, min, max) { return typeof n === "number" && Math.floor(n) === n && n >= min && n <= max; };
    return (whole(layer, 1, 32000) && whole(property, 0, 1000000)) ? { layer: layer, property: property } : null;
}
function aeProbeStartKeyInvalid(key, count) {
    return count > 256 || !key || key.length > 128 || key === "__proto__";
}
function aeProbeLayerStartsOf(value) {
    if (value === undefined) return {};
    if (!aeProbeIsRecord(value)) return null;
    var starts = {}, count = 0, key;
    for (key in value) {
        if (!aeHasOwn(value, key)) continue;
        count += 1;
        if (aeProbeStartKeyInvalid(key, count)) return null;
        starts[key] = aeProbeStartOf(value[key]);
        if (starts[key] === null) return null;
    }
    return starts;
}
function aeProbeItemRow(item, itemId, isComp, isFolder) {
    return { id: itemId, name: aeSafe(function () { return String(item.name); }, ""), type: isComp ? "composition" : (isFolder ? "folder" : "footage"),
      parentFolderId: aeSafe(function () { return item.parentFolder && String(item.parentFolder.id); }, null), compositionId: isComp ? itemId : null,
      sourceId: (!isComp && !isFolder) ? itemId : null };
}
function aeProbeSourceRow(item, itemId) {
    return { id: itemId, name: aeSafe(function () { return String(item.name); }, ""), type: aeSafe(function () { return (item.mainSource
      && item.mainSource.isStill) ? "solid" : "footage"; }, "unknown"), filePath: aeSafe(function () { return (item.file
      && item.file.fsName) ? String(item.file.fsName) : null; }, null), missing: !!aeSafeGet(item, "footageMissing", false), width: aeSafeGet(item,
      "width", 0), height: aeSafeGet(item, "height", 0), duration: aeSafeGet(item, "duration", 0), interpretation: aeSafe(function () {
      return aeFootageInterpretation(item) || undefined; }, undefined) };
}
function aeProbeRecordItem(found, item) {
    var itemId = String(aeSafeGet(item, "id", ""));
    var isComp = item instanceof CompItem, isFolder = item instanceof FolderItem;
    found.items.push(aeProbeItemRow(item, itemId, isComp, isFolder));
    if (!isComp && !isFolder) found.sources.push(aeProbeSourceRow(item, itemId));
}
function aeProbeWalkItems(itemCount, activeComp, config) {
    var found = { candidates: [], items: [], sources: [], compositionCount: 0 };
    for (var itemIndex = 1; itemIndex <= itemCount; itemIndex += 1) {
        aeProbeReadBudget(config, "item");
        var item = aeSafe(function () { return app.project.item(itemIndex); }, null);
        if (item) aeProbeRecordItem(found, item);
        if (item && item instanceof CompItem) {
            found.compositionCount += 1;
            if (found.compositionCount <= config.maxCompositions || item === activeComp) found.candidates.push(item);
        }
    }
    return found;
}
function aeProbeListedById(ids, wanted, candidates) {
    for (var i = 0; i < ids.length; i += 1) {
        var byId = aeSafe(function () { return app.project.itemByID(Number(ids[i])); }, null);
        if (byId && (byId instanceof CompItem) && String(aeSafeGet(byId, "id", "")) === ids[i] && aeOwnValue(wanted, ids[i]) === true) {
          candidates.push(byId); wanted[ids[i]] = false; }
    }
}
function aeProbeListedByWalk(wanted, itemCount, config, candidates) {
    for (var itemIndex = 1; itemIndex <= itemCount; itemIndex += 1) {
        aeProbeReadBudget(config, "item");
        var item = aeSafe(function () { return app.project.item(itemIndex); }, null);
        if (item && (item instanceof CompItem) && aeOwnValue(wanted, String(aeSafeGet(item, "id", ""))) === true) candidates.push(item);
    }
}
function aeProbeListedCompositions(ids, itemCount, config) {
    var candidates = [], wanted = {}, i;
    for (i = 0; i < ids.length; i += 1) wanted[ids[i]] = true;
    if (typeof app.project.itemByID === "function") aeProbeListedById(ids, wanted, candidates);
    else aeProbeListedByWalk(wanted, itemCount, config, candidates);
    return { candidates: candidates, items: [], sources: [], compositionCount: candidates.length };
}
function aeProbeParseStage(call) {
    var request, requestId;
    try { request = JSON.parse(call.raw); } catch (parseError) { return aeProbeError("", "INVALID_REQUEST", "Request was not valid JSON."); }
    requestId = (request && typeof request.requestId === "string") ? request.requestId : "";
    call.request = request; call.requestId = requestId;
    if (!request || request.schemaVersion !== AE_PROBE_SCHEMA || !requestId || requestId.length > 128) {return aeProbeError(requestId,
      "INVALID_REQUEST", "Expected schemaVersion 0.1 and a bounded requestId.");}
    return null;
}
function aeProbeHostStamp() {
    return aeSafe(function () { var stamp = (typeof aeCollectionStamp === "function") ? aeCollectionStamp() : null; return (stamp
      && typeof stamp.revision === "number" && stamp.revision >= 1 && stamp.epoch >= 1) ? { epoch: stamp.epoch, revision: stamp.revision } : null; }, null);
}
function aeProbeHostStage(call) {
    call.config = aeProbeLimits(call.request.limits);
    aeProbeReadStartedAt = (new Date()).getTime(); aeProbeReadProperties = 0; aeProbeReadItems = 0; aeProbeReadProgress = 0;
    call.host = aeProbeRuntime();
    call.hostStamp = aeProbeHostStamp();
    if (!call.host.compatible) {return aeProbeError(call.requestId, "UNSUPPORTED_HOST", "This probe requires After Effects 25 or later.", {
      appVersion: call.host.appVersion, buildNumber: call.host.buildNumber });}
    return null;
}
function aeProbeSelectedIds(activeComp) {
    var selected = activeComp ? (activeComp.selectedLayers || []) : [], selectedIds = [];
    for (var s = 0; s < selected.length; s += 1) selectedIds.push(String(aeSafe(function () { return selected[s].id; }, "")));
    return selectedIds;
}
function aeProbeProjectStage(call) {
    var includeEffects = call.request.includeEffects === true;
    call.warnings = [];
    call.census = includeEffects ? aeProbeInstalledEffects(call.config, call.warnings) : AE_PROBE_UNREAD_EFFECTS;
    if (!app.project) {return aeProbeError(call.requestId, "NO_PROJECT", "No After Effects project is open.", includeEffects ? {
      hostCensus: call.census } : undefined);}
    var active = app.project.activeItem;
    call.activeComp = (active && (active instanceof CompItem)) ? active : null;
    call.selectedIds = aeProbeSelectedIds(call.activeComp);
    return null;
}
function aeProbeRequestStage(call) {
    call.wanted = aeProbeWantedCompositions(call.request.compositionIds);
    if (call.wanted === false) return aeProbeError(call.requestId, "INVALID_REQUEST", "compositionIds must list 1 to 256 bounded composition ids.");
    call.starts = aeProbeLayerStartsOf(call.request.layerStarts);
    if (call.starts === null) {return aeProbeError(call.requestId, "INVALID_REQUEST",
      "layerStarts must map up to 256 bounded composition ids to a layer number, or {layer, property}.");}
    return null;
}
function aeProbeReadStage(call) {
    var request = call.request;
    call.itemCount = aeSafe(function () { return app.project.numItems; }, 0);
    call.listed = !!call.wanted && request.includeItems === false;
    call.found = call.listed ? aeProbeListedCompositions(request.compositionIds, call.itemCount, call.config) : aeProbeWalkItems(call.itemCount,
      call.activeComp, call.config);
    call.pages = aeProbeReadCompositions(call.found.candidates, { activeComp: call.activeComp, wanted: call.wanted, starts: call.starts,
      config: call.config, softMs: aeProbeInteger(request.softReadMs, 0, 0, 10000), warnings: call.warnings });
    return null;
}
var AE_PROBE_STAGES = [aeProbeParseStage, aeProbeHostStage, aeProbeProjectStage, aeProbeRequestStage, aeProbeReadStage];
function aeProbeCapabilityEnumeration(effectsState) {
    return { effects: effectsState, presets: "unknown", commands: "unsupported", importers: "unsupported", codecs: "unsupported",
      renderers: "unsupported", panels: "unsupported", scripts: "unsupported", utilities: "unsupported" };
}
function aeProbeEnvelope(call, capped) {
    var activeComp = call.activeComp, warnings = call.warnings, effectCatalogue = call.census, pages = call.pages;
    var projectName = aeSafe(function () { return String(app.project.file.displayName); }, "Untitled Project");
    var filePath = aeSafe(function () { return String(app.project.file.fsName); }, null);
    return { schemaVersion: AE_PROBE_SCHEMA, ok: true, requestId: call.requestId, result: { runtime: call.host, project: { name: projectName,
      filePath: filePath }, hostStamp: call.hostStamp || undefined, itemCount: call.itemCount, readScope: {
      compositions: call.wanted ? "listed" : "all", items: call.listed ? "skipped" : "read" },
      revision: String(call.itemCount) + ":" + (activeComp ? String(activeComp.id) : "none"),
      activeCompositionId: activeComp ? String(activeComp.id) : null, currentTime: activeComp ? aeSafeGet(activeComp, "time", 0) : null,
      selectedLayerIds: call.selectedIds, items: call.found.items, sources: call.found.sources, compositions: pages.compositions,
      installedEffects: effectCatalogue.items, capabilityEnumeration: aeProbeCapabilityEnumeration(effectCatalogue.state),
      inventoryTruncated: effectCatalogue.truncated, compositionPages: { unread: pages.unread, partial: pages.partial, capped: capped }, truncation: {
      truncated: warnings.length > 0, limits: call.config } }, warnings: warnings };
}
function aeProbeFinish(call) {
    var capped = !call.listed && call.found.compositionCount > call.config.maxCompositions, pages = call.pages;
    if (capped || pages.unread.length || pages.partial.length) call.warnings.push("composition-count-limit");
    var envelope = aeProbeEnvelope(call, capped);
    var interruptedApply = typeof aeReadApplyBreadcrumb === "function" ? aeReadApplyBreadcrumb() : null;
    if (interruptedApply) envelope.result.interruptedApply = interruptedApply;
    var serialized = JSON.stringify(envelope), over = aeProbeBytesOverLimit(serialized, call.config.maxPayloadBytes);
    if (over !== null) {return aeProbeError(call.requestId, "PAYLOAD_LIMIT", "Probe payload exceeded the requested byte limit.", { bytes: over,
      limit: call.config.maxPayloadBytes });}
    return serialized;
}
function aeProbeExecute(raw) {
    var call = { raw: raw, request: null, requestId: "" }, failure;
    for (var stage = 0; stage < AE_PROBE_STAGES.length; stage += 1) {
        failure = AE_PROBE_STAGES[stage](call);
        if (failure) return failure;
    }
    return aeProbeFinish(call);
}
/**
 * Whole-project read, paged. Takes the probe request JSON; returns the probe envelope JSON
 * {schemaVersion,ok:true,requestId,result,warnings}, or
 * {schemaVersion,ok:false,requestId,error:{code,message},warnings} with READ_BUDGET_EXCEEDED or PROBE_FAILED. Read-
 * only. The installed-effects census walks all of app.effects on AE's thread, so only a read that asks for it pays for
 * it. Compositions come in pages, the open one first, then project order; after the first a page stops at the soft
 * budget and leaves the rest unread, and a composition too big for the call comes back partial with the layer and
 * property to resume at, so none is ever too big to read.
 */
function aeEyesOpenProbe(raw) {
    try { var answer = aeProbeExecute(raw); return typeof answer === "string" ? answer : JSON.stringify(answer); } catch (unexpected) {
      return JSON.stringify(aeProbeError("", unexpected.readBudgetExceeded ? "READ_BUDGET_EXCEEDED" : "PROBE_FAILED",
      unexpected.readBudgetExceeded ? "Read stopped at its cooperative budget; no complete snapshot was collected. Use paged collection." : String(unexpected)));
      }
}
