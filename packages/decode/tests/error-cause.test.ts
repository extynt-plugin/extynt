/** The decoder-level helpers: errorCauseCode, decodeOrCode and isNotJson. */
import assert from "node:assert/strict";
import test from "node:test";
import { decode, decodeJson, decodeOrCode, errorCauseCode, isNotJson, number, object } from "../src/index.js";
import { errorOf, valueOf } from "./support.js";

test("errorCauseCode reads the code of a real error's cause", () => {
  const dropped = new TypeError("fetch failed", { cause: { code: "ECONNRESET", errno: -104 } });
  assert.equal(valueOf(errorCauseCode, dropped), "ECONNRESET");
});

test("errorCauseCode rejects an error with no cause code", () => {
  assert.equal(errorOf(errorCauseCode, new Error("plain")).path, "$.cause");
  assert.equal(errorOf(errorCauseCode, new Error("x", { cause: "text" })).path, "$.cause");
  assert.equal(errorOf(errorCauseCode, new Error("x", { cause: { code: 5 } })).path, "$.cause.code");
  assert.equal(decode(errorCauseCode, undefined).ok, false);
});

test("decodeOrCode returns the value of an accepted input", () => {
  assert.equal(decodeOrCode(number(), 3, "BAD"), 3);
});

test("decodeOrCode throws a plain Error whose message is the code", () => {
  assert.throws(() => decodeOrCode(object({}), 3, "BAD_INPUT"), { name: "Error", message: "BAD_INPUT" });
});

test("isNotJson is true for text that is not JSON and false for JSON of the wrong shape", () => {
  const notJson = decodeJson("{", number());
  const wrongShape = decodeJson('"x"', number());
  assert.ok(!notJson.ok && isNotJson(notJson.error));
  assert.ok(!wrongShape.ok && !isNotJson(wrongShape.error));
});

test("isNotJson is false for a decode failure at the root of a value", () => {
  assert.equal(isNotJson(errorOf(number(), "x")), false);
});
