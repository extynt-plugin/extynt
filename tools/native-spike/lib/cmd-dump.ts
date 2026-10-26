/** The dump command. */
import { decodeJson, isNotJson, jsonObject } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import type { CommandContext } from "./command-context.ts";
import { connectNative } from "./connect.ts";
import { SpikeError } from "./errors.ts";

function parseParams(text: string | undefined): JsonObject {
  if (text === undefined) return {};
  const decoded = decodeJson(text, jsonObject);
  if (decoded.ok) return decoded.value;
  if (isNotJson(decoded.error)) throw new SpikeError("USAGE", "dump: JSON-PARAMS is not valid JSON (quote it for your shell).");
  throw new SpikeError("USAGE", "dump: JSON-PARAMS must be a JSON object.");
}

/** Sends one request and prints the raw response; the exit code is 0 when the plugin answered ok. */
export async function dumpCommand({ options, io, positionals }: CommandContext): Promise<number> {
  const [op, rawParams] = positionals;
  if (!op) throw new SpikeError("USAGE", "dump needs an op name, e.g. dump read_project '{\"detail\":\"structure\"}'.");
  const params = parseParams(rawParams);
  const { client } = await connectNative(options);
  try {
    const { response, rttMs } = await client.request(op, params);
    io.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    io.stderr.write(`client rtt ${rttMs.toFixed(2)} ms\n`);
    return response.ok ? 0 : 1;
  } finally {
    client.close();
  }
}
