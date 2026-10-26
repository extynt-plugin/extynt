/** The compare command: native snapshot against the probe. */
import { isJsonObject } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import type { CliOptions } from "./args.ts";
import type { CommandContext } from "./command-context.ts";
import { compareSnapshots } from "./compare.ts";
import { DETAILS_ENTRY, detailsRequest, parseDetails } from "./compare-details.ts";
import type { DetailsAnswer, DetailsRequest } from "./compare-details.ts";
import { formatCompare } from "./compare-report.ts";
import { connectNative, publicDiscovery } from "./connect.ts";
import type { NativeClient } from "./client.ts";
import { SpikeError } from "./errors.ts";
import { emit } from "./output.ts";
import type { Io } from "./output.ts";
import { fetchSidecarSnapshot, loadProbeFile } from "./probe-input.ts";
import type { ClassifiedProbe } from "./probe-input.ts";
import { VERSION } from "./version.ts";

function readParams(options: CliOptions): JsonObject {
  return {
    detail: "full",
    hashes: false,
    ...(options.debugFlags ? { debugFlags: true } : {}),
    ...(options.maxProperties ? { maxPropertiesPerLayer: options.maxProperties } : {}),
    ...(options.maxDepth ? { maxPropertyDepth: options.maxDepth } : {}),
  };
}

async function requestDetails(client: NativeClient, request: DetailsRequest): Promise<DetailsAnswer> {
  try {
    const answer = await client.call("host_call", { entry: DETAILS_ENTRY, args: JSON.stringify(request) });
    const reply = answer.response.result;
    const text = isJsonObject(reply) ? reply.result : undefined;
    return parseDetails(String(text ?? ""));
  } catch (error) {
    if (!(error instanceof SpikeError) || error.exitCode === 2) throw error;
    return { ok: false, layers: [], error: error.message };
  }
}

async function fetchDetails(client: NativeClient, native: JsonObject, options: CliOptions): Promise<DetailsAnswer | null> {
  if (!options.details) return null;
  const request = detailsRequest(native);
  return request ? requestDetails(client, request) : { ok: true, layers: [] };
}

async function loadProbe(options: CliOptions, env: Io["env"]): Promise<ClassifiedProbe> {
  if (options.probe) return loadProbeFile(options.probe);
  return fetchSidecarSnapshot({ sidecar: options.sidecar, sidecarToken: options.sidecarToken, sessionFile: options.sessionFile, env });
}

/** Runs the comparison and prints it; the exit code is 0 for a pass and 1 for a fail. */
export async function compareCommand({ options, io, env }: CommandContext): Promise<number> {
  const { result: probe, input } = await loadProbe(options, env);
  const { client, discovery, discoveryPath } = await connectNative(options);
  let native: JsonObject, details: DetailsAnswer | null;
  try {
    const read = (await client.call("read_project", readParams(options))).response.result;
    native = isJsonObject(read) ? read : {};
    details = await fetchDetails(client, native, options);
  } finally {
    client.close();
  }
  const report = compareSnapshots(native, probe, { maxExamples: options.maxDiffs, probeInput: input, debugFlags: options.debugFlags, details });
  const result = { tool: "native-spike", version: VERSION, command: "compare", discovery: publicDiscovery(discovery, discoveryPath), ...report };
  emit({ options, io }, result, formatCompare(report));
  return report.verdict.pass ? 0 : 1;
}
