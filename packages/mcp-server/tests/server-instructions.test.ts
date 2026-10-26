// Proves the server instructions travel in the initialize answer, stay within their size budget, and name only tools an agent is offered.
import test from "node:test";
import assert from "node:assert/strict";
import { handleMcpRequest, INSTRUCTIONS_CHAR_BUDGET, listTools, MCP_SERVER_INSTRUCTIONS } from "../src/index.js";
import { objectAt, stringAt } from "../src/json.js";
import { framesOf, runStdio } from "./support/protocol-views.js";

test("initialize returns the server instructions within the size budget", () => {
  const response = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, {});
  assert.equal(stringAt(objectAt(response, "result"), "instructions"), MCP_SERVER_INSTRUCTIONS);
  assert.ok(MCP_SERVER_INSTRUCTIONS.length > 0 && MCP_SERVER_INSTRUCTIONS.length <= INSTRUCTIONS_CHAR_BUDGET, `instructions are ${MCP_SERVER_INSTRUCTIONS.length} chars, budget ${INSTRUCTIONS_CHAR_BUDGET}`);
  assert.ok(INSTRUCTIONS_CHAR_BUDGET / 4 <= 700, "the budget stays near 600 tokens at 4 chars per token");
});

test("every tool the instructions name is advertised to an agent", () => {
  const advertised = new Set(listTools("agent").map((tool) => tool.name));
  const named = new Set(MCP_SERVER_INSTRUCTIONS.match(/\bae_[a-z_]+/g));
  assert.ok(named.size > 5);
  for (const name of named) assert.ok(advertised.has(name), `instructions name ${name}, which is not advertised`);
});

test("the stdio launcher serves the instructions in its initialize answer", async () => {
  const run = await runStdio([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }]);
  const [response] = framesOf(run);
  assert.equal(stringAt(objectAt(response, "result"), "instructions"), MCP_SERVER_INSTRUCTIONS);
});
