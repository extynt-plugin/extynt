/** The model list the picker menu shows for the primary provider, and the search both model lists share. */
import { diagnosticId, send, transportContext } from "./panel-transport.js";
import { menuCatalogDecoder } from "./panel-model-wire.js";
import type { CatalogModel } from "./panel-model-wire.js";

/** The menu's model list: being asked for, refused with a sentence, or in hand. */
export type MenuCatalog =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly models: ReadonlyArray<CatalogModel> };

/** The list before the provider has answered. */
export const LOADING_CATALOG: MenuCatalog = { kind: "loading" };

/** True when the model's id or name contains the needle, which is already lower case; an empty needle matches everything. */
export function catalogMatches(model: CatalogModel, needle: string): boolean {
  return !needle || model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle);
}

/** Asks the sidecar which models the primary provider serves, and hands the outcome to `done`. */
export function fetchMenuCatalog(done: (catalog: MenuCatalog) => void): void {
  const path = "/v1/settings/model/catalog";
  const context = transportContext("GET", path, diagnosticId("model-catalog"));
  send({ method: "GET", path: path + "?slot=primary", body: null, context, decoder: menuCatalogDecoder }, (reply) => {
    done(reply.ok ? { kind: "ready", models: reply.value } : { kind: "failed", message: reply.error.reason });
  });
}
