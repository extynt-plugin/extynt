/** The host claims what the sidecar queues for it; a test that claims plan items by hand turns the picture-taking items off first. */
import type { ReadOnlySidecar } from "../src/server.js";
import { uiStoreFor } from "../src/ui-store.js";

export function withoutThumbnails<Sidecar extends ReadOnlySidecar>(sidecar: Sidecar): Sidecar {
  uiStoreFor(sidecar).patchPrefs({ showThumbnails: false });
  return sidecar;
}
