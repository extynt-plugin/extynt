/** The host census the fake plugin answers: the effects and fonts the seeded host profile says are installed, in the shape `aeHostCensus` returns. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeJson } from "@extynt/decode";
import { isWireObject, wireObject } from "@extynt/fake-plugin";
import type { HostMetadata } from "@extynt/project-graph";
import { listOf, memberOf, numberMember, pick, stringMember } from "./wire-reads.js";
import type { WireObject, WireValue } from "./wire-types.js";

const objectsOf = (value: WireValue | undefined): WireObject[] => listOf(value).filter(isWireObject);

function profileOf(directory: string): WireObject {
  try {
    const decoded = decodeJson(readFileSync(join(directory, "host-capability-profile.json"), "utf8"), wireObject);
    return decoded.ok ? decoded.value : {};
  } catch { return {}; }
}

function runtimeOf(host: HostMetadata): WireObject {
  return {
    application: host.application, appVersion: host.version, buildNumber: host.buildNumber, buildName: host.buildName ?? `${host.application} ${host.version}`,
    platform: host.platform, architecture: host.architecture, compatible: true,
  };
}

function effectOf(entry: WireObject): WireObject {
  const category = stringMember(entry, "category"), version = stringMember(entry, "version");
  return {
    ...pick(entry, ["matchName", "displayName"]), available: true,
    ...(category === undefined ? {} : { category }), ...(version === undefined ? {} : { version }),
  };
}

function completenessOf(inventory: WireObject): string {
  const completeness = inventory.completeness;
  return completeness === "partial" || completeness === "failed" ? completeness : "complete";
}

function fontsOf(profile: WireObject): WireObject {
  const inventory = memberOf(profile, "fontInventory");
  const source = isWireObject(inventory) ? inventory : {};
  const installed = objectsOf(source.items).map((font) => pick(font, ["family", "style", "postScriptName"]));
  return {
    installedFonts: installed, fontTotalReported: numberMember(source, "totalReported") ?? installed.length,
    fontFamiliesReported: numberMember(source, "familiesReported") ?? installed.length, fontCompleteness: completenessOf(source),
  };
}

function fontKeyOf(fonts: WireObject): string {
  const installed = objectsOf(fonts.installedFonts);
  return `ff1|${installed.length}|${installed.length}|${installed.map((font) => String(font.postScriptName)).join(",").length.toString(16)}`;
}

type CensusPart = "effects" | "fonts" | "all";

/** The part a request asks for: `parts` names it, and no `parts` is the whole census. */
export function censusPartOf(args: WireObject): CensusPart {
  const parts = listOf(args.parts);
  if (parts.length === 1) return parts[0] === "fonts" ? "fonts" : "effects";
  return "all";
}

interface CensusRequest { requestId: string; host: HostMetadata; profileDirectory: string; part?: CensusPart | undefined; known?: string | undefined }

function isInstalledEffect(entry: WireObject): boolean {
  return entry.kind === "effect" && entry.availability === "available" && typeof entry.matchName === "string";
}

/**
 * A successful census for `requestId`, or `undefined` when the profile lists no installed effect (an honest host with nothing to report). With the
 * fonts part, `known` is the key the sidecar holds: the same key answers "unchanged" and no list.
 */
export function censusOf(input: CensusRequest): WireObject | undefined {
  const profile = profileOf(input.profileDirectory), part = input.part ?? "all";
  const effects = objectsOf(profile.entries).filter(isInstalledEffect).map(effectOf);
  if (effects.length === 0) return undefined;
  const fonts = fontsOf(profile), key = fontKeyOf(fonts), unchanged = part === "fonts" && input.known === key;
  const effectFields = part === "fonts" ? {} : { installedEffects: effects, totalReported: effects.length, returnedCount: effects.length, completeness: "complete" };
  const fontFields = part === "effects" ? {} : { ...fonts, ...(unchanged ? { installedFonts: [] } : {}), fontFingerprint: key, fontsUnchanged: unchanged };
  return { schemaVersion: "0.1", ok: true, requestId: input.requestId, warnings: [], result: { runtime: runtimeOf(input.host), part, ...effectFields, ...fontFields } };
}
