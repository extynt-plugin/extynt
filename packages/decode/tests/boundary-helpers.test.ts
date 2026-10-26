/** The boundary helpers: accepts, instanceOf and the rejection handlers. */
import assert from "node:assert/strict";
import test from "node:test";
import { accepts, failureText, instanceOf, number, onError, onFailureText } from "../src/index.js";
import { errorOf, valueOf } from "./support.js";

test("accepts turns a decoder into a type guard", () => {
  const isNumber = accepts(number());
  assert.equal(isNumber(3), true);
  assert.equal(isNumber("3"), false);
  assert.equal(isNumber(Number.NaN), false);
});

test("instanceOf accepts instances of the class only", () => {
  const error = instanceOf(Error, "Error");
  assert.equal(valueOf(error, new TypeError("x")).message, "x");
  assert.equal(errorOf(error, { message: "x" }).expected, "Error");
});

test("failureText reads an Error message and stringifies anything else", () => {
  assert.equal(failureText(new Error("boom")), "boom");
  assert.equal(failureText("plain"), "plain");
  assert.equal(failureText(7), "7");
});

test("onFailureText hands the handler the text", async () => {
  assert.equal(await Promise.reject(new Error("no")).catch(onFailureText((message) => `got ${message}`)), "got no");
});

test("onError handles an Error and rethrows anything else", async () => {
  assert.equal(await Promise.reject(new Error("no")).catch(onError((error) => error.message)), "no");
  await assert.rejects(Promise.reject("text").catch(onError((error) => error.message)), (thrown) => thrown === "text");
});
