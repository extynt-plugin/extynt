// Proves a malformed JSON-RPC frame is answered Invalid Request or Invalid params, never as an unknown method.
import assert from "node:assert/strict";
import test from "node:test";
import { objectAt, numberAt, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { handleMcpRequest, parseRpcRequest } from "../src/rpc.js";

function errorOf(frame: JsonObject): JsonObject {
  const parsed = parseRpcRequest(frame);
  assert.equal(parsed.ok, false, "the frame must be refused");
  return parsed.ok ? {} : parsed.response;
}

test("a tools/call whose params.name is not a string is answered -32602 Invalid params", () => {
  const response = errorOf({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: 5 } });
  assert.equal(response.id, 4);
  const error = objectAt(response, "error");
  assert.equal(numberAt(error, "code"), -32602);
  assert.match(stringAt(error, "message") ?? "", /^Invalid params: /);
});

test("a tools/call whose params.arguments is not an object is answered -32602 Invalid params", () => {
  const error = objectAt(errorOf({ jsonrpc: "2.0", id: "a", method: "tools/call", params: { name: "ae_status", arguments: [1] } }), "error");
  assert.equal(numberAt(error, "code"), -32602);
});

test("a frame with the wrong protocol version or a non-string method is answered -32600 Invalid Request", () => {
  const version = objectAt(errorOf({ jsonrpc: "1.0", id: 1, method: "ping" }), "error");
  assert.equal(numberAt(version, "code"), -32600);
  assert.match(stringAt(version, "message") ?? "", /^Invalid Request: /);
  const method = objectAt(errorOf({ jsonrpc: "2.0", id: 2, method: 9 }), "error");
  assert.equal(numberAt(method, "code"), -32600);
});

test("a malformed id is answered with a null id", () => {
  const response = errorOf({ jsonrpc: "2.0", id: { nested: true }, method: "ping" });
  assert.equal(response.id, null);
  assert.equal(numberAt(objectAt(response, "error"), "code"), -32600);
});

test("a well-formed frame still decodes, and an unknown method alone is Method not found", () => {
  const parsed = parseRpcRequest({ jsonrpc: "2.0", id: 3, method: "no/such" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const response = handleMcpRequest(parsed.request, {});
  assert.equal(numberAt(objectAt(response, "error"), "code"), -32601);
});
