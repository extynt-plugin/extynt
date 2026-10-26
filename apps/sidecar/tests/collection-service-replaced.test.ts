/** What a demand is told when the host that owed its page is replaced: the replacement, not a bare cancellation. */
import type { JsonValue } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { decode, object, string } from "@extynt/decode";
import { CollectionService } from "../src/collection-service.js";

const failure = object({ error: object({ code: string() }) });

function error(service: CollectionService, ticket: JsonValue | undefined): string | undefined {
  const result = decode(failure, service.demandResult(String(ticket)));
  return result.ok ? result.value.error.code : undefined;
}

test("a host replacing an outstanding read fails its demand with COLLECTION_PANEL_REPLACED", () => {
  const service = new CollectionService();
  service.pair("first");
  const dispatch = service.demand({ begin: true, target: { kind: "index" } }, false);
  service.authorizeDispatch({ ticket: dispatch.ticket ?? null });
  service.pair("replacement");
  assert.equal(error(service, dispatch.ticket), "COLLECTION_PANEL_REPLACED");
  assert.equal(service.hasUnsettled(String(dispatch.ticket)), false, "the replaced host's read is retired, so new demands are not refused as busy");
  assert.ok(service.prepare({ begin: true, target: { kind: "index" } }, false).ticket);
});

test("a demand with no outstanding read is cancelled, not replaced, when the host changes", () => {
  const service = new CollectionService();
  service.pair("first");
  const dispatch = service.demand({ begin: true, target: { kind: "index" } }, false);
  service.cancelDemand(String(dispatch.ticket));
  service.pair("replacement");
  assert.equal(error(service, dispatch.ticket), "COLLECTION_CANCELLED");
});
