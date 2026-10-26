// Tests for external catalogue.
import test from "node:test";
import assert from "node:assert/strict";
import { callTool, EXTERNAL_HIDDEN_TOOLS, handleMcpRequest, listTools, MCP_SERVER_INSTRUCTIONS, TOOL_DEFINITIONS } from "../src/index.js";


const EXTERNAL_SCHEMA_CHAR_BUDGET = 29_100;

test("tools hidden from external clients are not listed but still dispatch", () => {
  const listed = new Set(listTools("agent").map((tool) => tool.name));
  const handshake = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {});
  assert.equal(JSON.stringify(handshake.result), JSON.stringify({ tools: listTools("agent") }));
  assert.ok(EXTERNAL_HIDDEN_TOOLS.size >= 20);
  assert.ok(EXTERNAL_HIDDEN_TOOLS.has("ae_get_effect_controls") && !EXTERNAL_HIDDEN_TOOLS.has("ae_undo_plan"));
  const declared = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
  for (const name of EXTERNAL_HIDDEN_TOOLS) {
    assert.ok(declared.has(name), `${name} is declared`);
    assert.ok(!listed.has(name), `${name} is not listed to external clients`);
    assert.ok(listTools("all").some((tool) => tool.name === name), `${name} stays in the full catalogue`);
    const answer = callTool(name, {}, {});
    const code = answer.ok ? "" : answer.error.code;
    assert.ok(code !== "UNSUPPORTED_TOOL" && code !== "INVALID_TOOL", `${name} is still answered by name`);
  }
});

test("no listed text names a tool that is not listed", () => {
  const listed = listTools("agent");
  const names = new Set(listed.map((tool) => tool.name));
  const texts: Array<[string, string]> = [["initialize instructions", MCP_SERVER_INSTRUCTIONS], ...listed.map((tool): [string, string] => [tool.name, JSON.stringify(tool)])];
  for (const [owner, text] of texts) {
    for (const named of new Set(text.match(/\bae_[a-z_]+/g))) assert.ok(names.has(named), `${owner} names ${named}, which external clients are not offered`);
  }
});

test("the listed external schemas stay within their size budget", () => {
  const size = JSON.stringify(listTools("agent")).length;
  assert.ok(size <= EXTERNAL_SCHEMA_CHAR_BUDGET, `listed schemas are ${size} chars, budget ${EXTERNAL_SCHEMA_CHAR_BUDGET}`);
});
