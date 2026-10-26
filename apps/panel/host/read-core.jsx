/* Probe read: schema, limits, the cooperative read budget, host runtime description and payload size checks. It is the
 * shared base of the read-*.jsx probe parts.
 */
/* global aeSafe */
/* exported aeProbeBytesOverLimit, aeProbeElapsedAtLeast, aeProbeError, aeProbeLimits, aeProbeReadBudget, aeProbeReadProgress, aeProbeRuntime */
var AE_PROBE_SCHEMA = "0.1";
var AE_PROBE_VERIFIED_VERSION = "26.2.1";
var AE_PROBE_VERIFIED_BUILD = "2";
var AE_PROBE_MIN_MAJOR = 25;
var AE_PROBE_DEFAULTS = { maxCompositions: 32, maxLayersPerComposition: 32000, maxPropertyDepth: 8, maxPropertiesPerLayer: 512, maxEffects: 4096,
  maxPayloadBytes: 2000000 };
/** The read budget's progress for the call in flight: its start time and the properties and items read so far, plus an overall progress count. */
var aeProbeReadStartedAt = 0, aeProbeReadProperties = 0, aeProbeReadItems = 0, aeProbeReadProgress = 0;
/**
 * Counts a read of kind "property" or "item". Returns nothing; throws an Error with readBudgetExceeded set when the
 * time or count budget is spent. A cooperative admission budget that only stops a runaway read, since a single host
 * getter cannot be preempted; a real scene fits one refresh.
 */
function aeProbeReadBudget(config, kind) {
    if (kind === "property") aeProbeReadProperties += 1;
    if (kind === "item") aeProbeReadItems += 1;
    if ((new Date()).getTime() - aeProbeReadStartedAt >= config.maxReadMs ||
        aeProbeReadProperties > config.maxTotalProperties || aeProbeReadItems > config.maxProjectItems) {
        var refusal = new Error("READ_BUDGET_EXCEEDED");
        refusal.readBudgetExceeded = true;
        throw refusal;
    }
}
/** True when at least ms milliseconds passed since the read started. */
function aeProbeElapsedAtLeast(ms) { return (new Date()).getTime() - aeProbeReadStartedAt >= ms; }
/** Probe failure envelope. Returns {schemaVersion,ok:false,requestId,error:{code,message[,details]},warnings:[]}. */
function aeProbeError(requestId, code, message, details) {
    var result = { schemaVersion: AE_PROBE_SCHEMA, ok: false, requestId: requestId || "", error: { code: code, message: message }, warnings: [] };
    if (details) result.error.details = details;
    return result;
}
function aeProbeInteger(value, fallback, min, max) {
    return (typeof value === "number" && isFinite(value) && Math.floor(value) === value) ? Math.min(max, Math.max(min, value)) : fallback;
}

  /** Request limits clamped to their ranges. Returns {maxCompositions,maxLayersPerComposition,maxPropertyDepth,maxPropertiesPerLayer,maxEffects,
  maxPayloadBytes,maxReadMs,maxTotalProperties,maxProjectItems}. */
function aeProbeLimits(input) {
    input = input || {};
    return {
        maxCompositions: aeProbeInteger(input.maxCompositions, AE_PROBE_DEFAULTS.maxCompositions, 1, 256),
        maxLayersPerComposition: aeProbeInteger(input.maxLayersPerComposition, AE_PROBE_DEFAULTS.maxLayersPerComposition, 1, 32000),
        maxPropertyDepth: aeProbeInteger(input.maxPropertyDepth, AE_PROBE_DEFAULTS.maxPropertyDepth, 0, 32),
        maxPropertiesPerLayer: aeProbeInteger(input.maxPropertiesPerLayer, AE_PROBE_DEFAULTS.maxPropertiesPerLayer, 1, 10000),
        maxEffects: aeProbeInteger(input.maxEffects, AE_PROBE_DEFAULTS.maxEffects, 1, 10000),
        maxPayloadBytes: aeProbeInteger(input.maxPayloadBytes, AE_PROBE_DEFAULTS.maxPayloadBytes, 1024, 10000000),
        maxReadMs: aeProbeInteger(input.maxReadMs, 3000, 10, 10000),
        maxTotalProperties: aeProbeInteger(input.maxTotalProperties, 40000, 1, 100000),
        maxProjectItems: aeProbeInteger(input.maxProjectItems, 10000, 1, 50000)
    };
}
function aeProbeBuildNumber() {
    var direct = aeSafe(function () { return app.buildNumber; }, null);
    if (direct !== null && direct !== undefined && String(direct) !== "" && String(direct) !== "undefined") return String(direct);
    var buildName = aeSafe(function () { return String(app.buildName); }, "");
    var match = buildName.match(/Build\s+([0-9]+)/i);
    return match ? String(match[1]) : null;
}
function aeProbeProductVersion(value) {
    var match = String(value).match(/^([0-9]+\.[0-9]+\.[0-9]+)(?:x[0-9]+)?$/i);
    return match ? match[1] : String(value);
}
function aeProbeUtf8Bytes(text) {
    try {
        var encoded = encodeURIComponent(String(text)), count = 0, i = 0;
        while (i < encoded.length) {
            if (encoded.charAt(i) === "%") { count += 1; i += 3; } else { count += 1; i += 1; }
        }
        return count;
    } catch (ignored) { return String(text).length; }
}
// Bytes when the payload is over the limit, else null. A UTF-16 unit encodes to 1-3 bytes, so the length alone decides most payloads;
// only the band in between is counted. An over-limit payload reports its length, a lower bound, rather than encoding it first.
function aeProbeBytesOverLimit(text, maxBytes) {
    if (text.length * 3 <= maxBytes) return null;
    var bytes = text.length > maxBytes ? text.length : aeProbeUtf8Bytes(text);
    return bytes > maxBytes ? bytes : null;
}
function aeProbeWithinSupportedRange(product) {
    var match = String(product).match(/^([0-9]+)\.([0-9]+)\.[0-9]+$/);
    if (!match) return false;
    return parseInt(match[1], 10) >= AE_PROBE_MIN_MAJOR;
}
/**
 * Returns {application,appVersion,buildNumber,buildName,platform,architecture,...} for the running After Effects.
 * Reports app.version raw but compares only the product part, so a build suffix such as "x2" does not matter; AE 25
 * and newer are accepted.
 */
function aeProbeRuntime() {
    var version = aeSafe(function () { return String(app.version); }, "unknown");
    var build = aeProbeBuildNumber();
    var buildName = aeSafe(function () { return String(app.buildName); }, null);
    var product = aeProbeProductVersion(version);
    var isoLanguage = aeSafe(function () { return String(app.isoLanguage); }, null);
    return { application: "After Effects", appVersion: version, buildNumber: build, buildName: buildName, isoLanguage: isoLanguage, platform: ($.os && $.os.indexOf("Mac") === 0) ? "macOS" : (($.os && $.os.indexOf("Windows") === 0) ? "Windows" : "unknown"), architecture: "unknown", compatible: aeProbeWithinSupportedRange(product), verified: product === AE_PROBE_VERIFIED_VERSION && build === AE_PROBE_VERIFIED_BUILD };
}
