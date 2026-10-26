/** The documented differences between a native envelope and the probe envelope of the same project, held by the golden test. */

interface DocumentedDifference { field: string; native: string; probe: string; reason: string }

/** Where a native envelope, normalised, differs from the probe envelope of the same project. Everything not listed is identical, and the golden test (native-snapshot-golden.test.ts) holds it to that. */
export const DOCUMENTED_DIFFERENCES: readonly DocumentedDifference[] = [
  { field: "host.buildName", native: "null", probe: "app.buildName", reason: "ping_direct reports only `aeVersion` (\"26.2.1 (build 2)\"), which the adapter splits into appVersion and buildNumber." },
  { field: "host.platform / host.architecture", native: "sidecar OS (macOS or Windows) / ping.arch", probe: "$.os / \"unknown\"", reason: "The plugin and the sidecar run on the same machine, so the sidecar's OS is the host's; the plugin knows its architecture, ExtendScript does not." },
  { field: "revision, freshness.revision", native: "String(stamp.revision)", probe: "\"<itemCount>:<activeCompId>\"", reason: "The native stamp is AE's own change counter. Neither feeds the graph fingerprint." },
  { field: "hostStamp", native: "{epoch, revision} from watch_state", probe: "aeCollectionStamp()", reason: "Same shape; the epoch is plugin-owned in native mode." },
  { field: "layer/property rows: hash, dynFlags", native: "stripped", probe: "absent", reason: "Plugin-only members; hashes move to the LayerHashIndex." },
  { field: "property value of marker, shape-path (mask and vector paths), layer-id", native: "null, else details value", probe: "the marker list, a path value, a layer index", reason: "The plugin does not read these values; the jsx details call (aeReadPropertyDetails) supplies them where a plan reaches." },
  { field: "property value of mask-id, arbitrary", native: "null", probe: "String(value)", reason: "The plugin does not read these values; a string rendering of a host object is not a fact." },
  { field: "property value of a text document", native: "details value, else null", probe: "the document object", reason: "Read by the jsx details call (aeReadPropertyDetails) only where the plan reaches." },
  { field: "property keyDigest, keyDigestTruncated, shapeKeys", native: "details value, else absent", probe: "always for keyed properties", reason: "Same source: the jsx details call." },
  { field: "per-character-3d switch", native: "null", probe: "boolean or null", reason: "Not exposed through AEGP (native-spike compare skips it too)." },
  { field: "installedEffects, capabilityEnumeration, inventoryTruncated", native: "absent", probe: "present with includeEffects", reason: "The host census (aeHostCensus) supplies these, as it already does for a startup census." },
  { field: "compositionPages", native: "{unread: [], partial: [], capped: false}", probe: "reflects the probe's budget", reason: "A native read is never paged." },
  { field: "truncation.limits", native: "{}", probe: "the probe's read limits", reason: "The plugin has no equivalent limit record." },
];
