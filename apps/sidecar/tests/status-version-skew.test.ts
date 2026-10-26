/** ae_status says which MCP server process answered, not which one this sidecar was built with. */
import { fieldOf, flagOf, readJson, textOf } from "./http-json.js";
import { authorization, sidecarFor, token } from "./sidecar-fixture.js";
import { MCP_SERVER_VERSION } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import test from "node:test";

async function status(t: { after: (fn: () => void | Promise<void>) => void }, headers: Record<string, string>) {
  const sidecar = sidecarFor({ port: 0, token, quietAgentLog: true });
  const address = await sidecar.start(); t.after(() => sidecar.stop());
  const response = await fetch(`http://${address.host}:${address.port}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", ...headers }, body: JSON.stringify({ name: "ae_status" }) });
  assert.equal(response.status, 200);
  return readJson(response);
}

test("an agent running an older MCP process is reported as skewed, with the version it runs and the remedy", async (t) => {
  const body = await status(t, { "X-AE-Client": "agent", "X-AE-Client-Version": "0.1.0b" });
  assert.equal(textOf(body, "data.mcpServerVersion"), "0.1.0b", "the version of the process that asked, computed in that process");
  assert.equal(textOf(body, "data.sidecarMcpVersion"), MCP_SERVER_VERSION, "what this sidecar expects");
  assert.equal(flagOf(body, "data.versionSkew"), true);
  assert.match(textOf(body, "data.versionSkewRemedy"), /0\.1\.0b.*expects .*Restart Claude Desktop \/ your MCP client to load the new extynt MCP server\./);
});

test("an MCP process from before version reporting is skewed too, and says so", async (t) => {
  const body = await status(t, { "X-AE-Client": "agent" });
  assert.equal(fieldOf(body, "data.mcpServerVersion"), null);
  assert.equal(flagOf(body, "data.versionSkew"), true);
  assert.match(textOf(body, "data.versionSkewRemedy"), /predates version reporting.*Restart Claude Desktop/);
});

test("a matching agent, and a caller with no MCP process, are not skewed", async (t) => {
  const matching = await status(t, { "X-AE-Client": "agent", "X-AE-Client-Version": MCP_SERVER_VERSION });
  assert.equal(textOf(matching, "data.mcpServerVersion"), MCP_SERVER_VERSION); assert.equal(flagOf(matching, "data.versionSkew"), false);
  assert.equal(fieldOf(matching, "data.versionSkewRemedy"), undefined);
  const panel = await status(t, {});
  assert.equal(textOf(panel, "data.mcpServerVersion"), MCP_SERVER_VERSION); assert.equal(flagOf(panel, "data.versionSkew"), false);
});
