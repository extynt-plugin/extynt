// The host capability profile tools: a summary and a status of what the host offers, a search, a per-capability description, and the font search.
import { numberedMenu, describeControlWrites } from "@extynt/capability-catalogue";
import type { ControlSchema, HostCapabilityProfile, HostProfileEntry } from "@extynt/capability-catalogue";
import type { Infer } from "@extynt/decode";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { boundedAt, jsonOf } from "./json.js";
import { observedEffectControls } from "./observed-controls.js";
import { hostCapabilitySearch, hostFontSearch } from "./profile-search.js";
import type { PagedCall } from "./profile-search.js";
import { decodeCursor, encodeCursor, profileOverview } from "./profile-view.js";
import type { HostRequest } from "./tool-handle.js";
import { AE_DESCRIBE_HOST_CAPABILITY } from "./tool-specs-host.js";
import { hostSuccess, toolError } from "./tool-result.js";
import type { ToolResult } from "./tool-result.js";

type DescribeArgs = Infer<typeof AE_DESCRIBE_HOST_CAPABILITY.input.decoder>;

type DetailKind = NonNullable<DescribeArgs["detail"]>;

interface ProfileArgs {
  readonly knownProfileId?: string;
  readonly profileId?: string;
  readonly cursor?: string;
}

const PROBE_NEEDED_SHOWN = 50;
const NOT_MODIFIED_BUDGET_BYTES = 512;
const DETAIL_BUDGET_BYTES = 16_000;
const DETAIL_LIMITS = { fallback: 25, min: 1, max: 50 };

function hostProfileSummary({ name, profile }: PagedCall<ProfileArgs>): ToolResult {
  return hostSuccess(name, jsonOf({ ...profileOverview(profile), host: profile.host }));
}

function hostProfileStatus({ name, profile }: PagedCall<ProfileArgs>): ToolResult {
  return hostSuccess(name, jsonOf({
    ...profileOverview(profile),
    probeNeeded: profile.probeNeeded.slice(0, PROBE_NEEDED_SHOWN),
    probeNeededTruncated: profile.probeNeeded.length > PROBE_NEEDED_SHOWN,
    deepProbe: "manual Capability Lab only; unavailable automatically",
  }));
}

function capabilityEntry(profile: HostCapabilityProfile, requestedId: string): HostProfileEntry | undefined {
  const byId = profile.entries.find((candidate) => candidate.id === requestedId);
  if (byId || !requestedId.startsWith("host:")) return byId;
  return profile.entries.find((candidate) => candidate.kind === "effect" && candidate.matchName === requestedId.slice("host:".length));
}

function describedControl(control: ControlSchema): ControlSchema {
  return control.menu ? { ...control, menu: numberedMenu(control.menu) } : control;
}

function lacksSchema(entry: HostProfileEntry): boolean {
  return entry.kind === "effect" && Boolean(entry.matchName) && !(entry.controls ?? []).length;
}

function detailItems(entry: HostProfileEntry, detail: DetailKind, snapshot: ProjectSnapshot | undefined) {
  if (detail === "controls") return entry.controls?.length ? entry.controls.map(describedControl) : observedControls(entry, snapshot);
  if (detail === "evidence") return entry.evidence;
  if (detail === "usage") return [{ description: entry.description, applicability: entry.applicability ?? [], requirements: entry.requirements ?? [] }];
  return [];
}

function observedControls(entry: HostProfileEntry, snapshot: ProjectSnapshot | undefined) {
  return lacksSchema(entry) && entry.matchName ? observedEffectControls(snapshot, entry.matchName) : [];
}

function controlDiscovery(entry: HostProfileEntry) {
  if (!lacksSchema(entry)) return {};
  return {
    controlPathFormat: `ADBE Effect Parade/${entry.matchName}/<control matchName>`,
    controlDiscovery: "No control schema is cached for this effect on this host yet, and none will arrive during this turn. Do not guess control matchNames: add it with ensure_effect (or find a layer that has it), then ae_inspect_layer with pathPrefix \"ADBE Effect Parade\" to read exact control paths, ranges, and values.",
  };
}

function controlProvenance(entry: HostProfileEntry, listed: number) {
  if (listed && !entry.controls?.length) return { controlSource: "observed on a layer in the current snapshot; ranges and menus are not cached. Read exact ranges with ae_inspect_layer." };
  return controlDiscovery(entry);
}

function hostCapabilityDetail({ name, args, profile, context, offset }: PagedCall<DescribeArgs>): ToolResult {
  const entry = capabilityEntry(profile, args.id);
  if (!entry) return hostSuccess(name, null);
  const detail: DetailKind = args.detail ?? "summary";
  if (detail === "summary") return hostSuccess(name, jsonOf({ ...entry, controls: undefined, ...controlDiscovery(entry) }));
  const limit = boundedAt(args, "limit", DETAIL_LIMITS);
  const list = detailItems(entry, detail, context.snapshot);
  const items = list.slice(offset, offset + limit);
  const nextCursor = offset + items.length < list.length ? encodeCursor(profile.profileId, offset + items.length) : null;
  const writes = detail === "controls" ? { writeShapes: describeControlWrites(entry.controls ?? []), ...controlProvenance(entry, list.length) } : {};
  return hostSuccess(name, jsonOf({ profileId: profile.profileId, id: entry.id, detail, items, nextCursor, ...writes, responseBudgetBytes: DETAIL_BUDGET_BYTES }));
}

function cursorOffset(args: ProfileArgs, profile: HostCapabilityProfile): number | ToolResult {
  const cursor = args.cursor;
  if (!cursor) return 0;
  const decoded = decodeCursor(cursor);
  if (!decoded || decoded.profileId !== profile.profileId) return toolError("PROFILE_CHANGED", "Cursor belongs to another Host Capability Profile.");
  return decoded.offset;
}

function profileTool<A extends ProfileArgs>(answer: (call: PagedCall<A>) => ToolResult): (request: HostRequest<A>) => ToolResult {
  return ({ name, args, context }) => {
    const { hostProfile: profile } = context;
    if (!profile) return toolError("NO_HOST_PROFILE", "Refresh the host census to build the Host Capability Profile.");
    if (args.profileId !== undefined && args.profileId !== profile.profileId) return toolError("PROFILE_CHANGED", "Requested Host Capability Profile is no longer current.");
    if (args.knownProfileId === profile.profileId && !args.cursor) {
      return hostSuccess(name, { status: "NOT_MODIFIED", profileId: profile.profileId, responseBudgetBytes: NOT_MODIFIED_BUDGET_BYTES });
    }
    const offset = cursorOffset(args, profile);
    return typeof offset === "number" ? answer({ name, args, profile, context, offset }) : offset;
  };
}

/** Answers ae_get_host_profile_summary from the profile the context holds. */
export const hostProfileSummaryTool = profileTool(hostProfileSummary);

/** Answers ae_get_host_profile_status from the profile the context holds. */
export const hostProfileStatusTool = profileTool(hostProfileStatus);

/** Answers ae_search_host_capabilities from the profile the context holds. */
export const hostCapabilitySearchTool = profileTool(hostCapabilitySearch);

/** Answers ae_describe_host_capability from the profile the context holds. */
export const hostCapabilityDetailTool = profileTool(hostCapabilityDetail);

/** Answers ae_search_fonts from the profile the context holds. */
export const hostFontSearchTool = profileTool(hostFontSearch);
