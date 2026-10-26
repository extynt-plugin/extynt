// Which After Effects the plugin is in, as the plugin reports it (`host` in `ping` and `ping_direct`) and as the sidecar derives it from the version text for a plugin that predates the field.
// The floor, the measured majors and the native SVG major mirror core/host_version.cpp; native/extynt-core/tests/vectors/host_versions.json holds both implementations to the same answers.
import { boolean, literal, map, nullable, number, object, string } from "@extynt/decode";
import type { Decoder, Infer, ObjectOf } from "@extynt/decode";

export const HOST_FAMILIES = ["unknown", "older", "ae25", "ae26", "newer"] as const;
export type HostFamily = typeof HOST_FAMILIES[number];
export type SvgImportRoute = "native" | "converter" | "unknown";

const FLOOR_MAJOR = 25;
const NEWEST_MEASURED_MAJOR = 26;
const AE25_MEASURED_ON_REAL_HOST = false;
const MEASURED_MAJORS: readonly number[] = AE25_MEASURED_ON_REAL_HOST ? [FLOOR_MAJOR, NEWEST_MEASURED_MAJOR] : [NEWEST_MEASURED_MAJOR];
const VERSION_TEXT = /^\s*(\d+)\.(\d+)(?:\.(\d+))?(?=$|[\sx(])(?:x([0-9A-Za-z.]+)|[^(]*\(build ([0-9A-Za-z.]+)\))?/;

/** The first major whose own SVG importer extynt uses, decided for AE 25 by a run on a real AE 25. */
export const NATIVE_SVG_MIN_MAJOR = 26;

const versionFacts = {
  version: string(), major: nullable(number()), minor: nullable(number()), patch: nullable(number()), build: nullable(string()),
  family: literal(...HOST_FAMILIES), supported: boolean(), measured: boolean(), experimental: boolean(),
};
type VersionFacts = ObjectOf<typeof versionFacts>;

const pluginCapabilities = object({
  svgImport: literal("native", "converter", "unknown"), expressionText: literal("utf16", "utf8"),
  suitesComplete: boolean(), streamSuite: number(), revisionGuard: literal("on", "off"),
});

/**
 * The capabilities a plugin measured on its own load: how SVG artwork is built (`svgImport`: After Effects' importer from 26, extynt's converter before),
 * what `AEGP_GetExpression` returns, whether every suite the reads need loaded, and `revisionGuard`, `off` when the plugin leaves `app.project.revision`
 * out of every stamp on this release so only the content fingerprint guards.
 */
export type PluginHostCapabilities = Infer<typeof pluginCapabilities>;

/**
 * The capabilities the version text alone gives: what a plugin measures is `unknown` or null, and `revisionGuard` is `on` because a plugin that predates
 * the field always reads the revision.
 */
export interface DerivedHostCapabilities {
  readonly svgImport: SvgImportRoute;
  readonly expressionText: "unknown";
  readonly suitesComplete: null;
  readonly streamSuite: null;
  readonly revisionGuard: "on";
}
export type HostCapabilities = PluginHostCapabilities | DerivedHostCapabilities;

/**
 * An identity the plugin reported. `supported` is false only below the floor (AE 25.0); `measured` is true for the majors whose behaviour was measured on
 * a real host; `experimental` marks a release newer than the newest measured one, shown to the user, the agent and every receipt as EXPERIMENTAL.
 */
export type PluginHostIdentity = VersionFacts & {
  readonly source: "plugin";
  readonly aegpApi: string;
  readonly capabilities: PluginHostCapabilities;
};

/** An identity the sidecar parsed from `aeVersion`, so only the version-based fields are known; an unreadable version is not blocked, only unmeasured. */
export type DerivedHostIdentity = VersionFacts & {
  readonly source: "derived";
  readonly aegpApi: null;
  readonly capabilities: DerivedHostCapabilities;
};
export type HostIdentity = PluginHostIdentity | DerivedHostIdentity;

/** Decodes the plugin's `host` object, which must be complete: a malformed one is rejected whole, never half-read. */
export const pluginHostIdentity: Decoder<PluginHostIdentity> = map(
  object({ ...versionFacts, aegpApi: string(), capabilities: pluginCapabilities }),
  (fields) => ({ source: "plugin" as const, ...fields }),
);

function familyOf(major: number | null): HostFamily {
  if (major === null) return "unknown";
  if (major < FLOOR_MAJOR) return "older";
  if (major === FLOOR_MAJOR) return "ae25";
  return major === NEWEST_MEASURED_MAJOR ? "ae26" : "newer";
}

function svgRouteOf(major: number | null): SvgImportRoute {
  if (major === null) return "unknown";
  return major >= NATIVE_SVG_MIN_MAJOR ? "native" : "converter";
}

function versionParts(versionText: string): Pick<VersionFacts, "major" | "minor" | "patch" | "build"> {
  const match = VERSION_TEXT.exec(versionText);
  if (!match) return { major: null, minor: null, patch: null, build: null };
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0), build: match[4] ?? match[5] ?? null };
}

/** The identity the version text alone gives; the plugin's measured facts (suites, API) are left unknown. */
export function deriveHostIdentity(versionText: string): DerivedHostIdentity {
  const parts = versionParts(versionText);
  const family = familyOf(parts.major);
  return {
    source: "derived", version: versionText, ...parts, family, supported: family !== "older",
    measured: parts.major !== null && MEASURED_MAJORS.includes(parts.major), experimental: family === "newer", aegpApi: null,
    capabilities: { svgImport: svgRouteOf(parts.major), expressionText: "unknown", suitesComplete: null, streamSuite: null, revisionGuard: "on" },
  };
}

/** What the sidecar reports for a connection: the plugin's own answer, else the one derived from the version text it gave. */
export function hostIdentityOf(reported: HostIdentity | null | undefined, aeVersion: string | null): HostIdentity | null {
  if (reported) return reported;
  return aeVersion === null ? null : deriveHostIdentity(aeVersion);
}

function releaseNote(host: HostIdentity): string {
  if (host.experimental) return ", EXPERIMENTAL (newer than any measured release)";
  return host.measured ? "" : ", unmeasured";
}

/** One line for logs and the agent: "After Effects 25.6.0 (build 41), ae25, unmeasured". */
export function describeHost(host: HostIdentity | null): string {
  if (!host) return "After Effects (version unknown)";
  return `After Effects ${host.version}, ${host.family}${host.supported ? "" : ", below the supported floor"}${releaseNote(host)}`;
}

/** Why extynt will not work with this host, in words for the user; null when it will (a host whose version could not be read is not refused). Below AE 25 extynt refuses to pair rather than warn. */
export function hostRefusal(host: HostIdentity | null): string | null {
  if (!host || host.supported) return null;
  return `extynt needs After Effects ${FLOOR_MAJOR} or later; this is After Effects ${host.version}. Update After Effects and extynt will connect.`;
}

function supportNote(host: HostIdentity): string | null {
  if (!host.supported) return `After Effects ${host.version} is older than the oldest release extynt supports (${FLOOR_MAJOR}). Make no changes; tell the user to update After Effects.`;
  if (host.experimental) return `After Effects ${host.version} is EXPERIMENTAL for extynt: it is newer than any release extynt has been tested on. Treat each read-back as the only evidence, say once in your report that this host is experimental, and say so plainly if a result looks wrong.`;
  if (!host.measured) return `After Effects ${host.version} is supported but not yet measured: extynt's behaviour on this release has not been checked against a real host, so a read-back that disagrees with a plan is evidence, not a bug in the plan.`;
  return null;
}

const REVISION_GUARD_OFF_NOTE = "The project revision is not read on this release, so freshness rests on content fingerprints alone: re-read before applying after any edit.";

/** What the agent is told about this host as one short paragraph, or null when there is nothing to say (a measured release with every capability on). The typed fields in ae_status are the data; this is the instruction. */
export function hostBriefingNote(host: HostIdentity | null): string | null {
  if (!host) return null;
  const lines = [supportNote(host), host.capabilities.revisionGuard === "off" ? REVISION_GUARD_OFF_NOTE : null].filter((line) => line !== null);
  return lines.length > 0 ? lines.join(" ") : null;
}
