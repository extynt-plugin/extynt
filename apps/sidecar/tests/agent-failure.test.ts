/** Provider failures: a 429 for exhausted credit or a spending limit points to billing, while real throttling stays retryable. */
import assert from "node:assert/strict";
import test from "node:test";
import { providerFailure } from "../src/agent-failure.js";

const provider = { displayName: "OpenAI", keyVariable: "OPENAI_API_KEY" };

test("OpenAI 429 credit exhaustion points to billing, while actual throttling remains retryable", () => {
  const credits = { status: 429, detail: JSON.stringify({ error: { code: "credit_balance_exhausted", type: "insufficient_quota" } }) };
  assert.deepEqual(providerFailure(credits, provider), { code: "PROVIDER_BILLING", message: "OpenAI has no API credits remaining. Add credits in the provider's billing settings, then try again." });
  const limit = { status: 429, detail: JSON.stringify({ error: { code: "rate_limit_exceeded" } }) };
  assert.equal(providerFailure(limit, provider).code, "PROVIDER_RATE_LIMIT");
});

test("OpenAI spending limit 429 points to usage settings", () => {
  const limit = { status: 429, detail: JSON.stringify({ error: { code: "project_spend_limit_exceeded" } }) };
  assert.equal(providerFailure(limit, provider).code, "PROVIDER_BILLING");
  assert.match(providerFailure(limit, provider).message, /project usage limit|account or project usage limit/);
});
