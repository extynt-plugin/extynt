// The shapes of one native collection read in flight: its job, its outstanding ticket, the validated page and the rows and layers retained from it.
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { CollectionTarget } from "./collection-request.js";

/** One layer of a composition inventory: the facts the sidecar reads from it and the row as the host reported it. */
export interface LayerRow { id: string; index: number; selected: boolean; raw: JsonObject }

/** The composition metadata a layer inventory is bound to, with the exact JSON text used to detect a change between pages. */
export interface LayerMetadata { raw: JsonObject; json: string; layerCount: number; composition: JsonObject; compositionId: string }

/** A read the sidecar owns across pages: its target, cursor, session, the stamp it is bound to and the layers gathered so far. */
export interface CollectionJob {
  id: string; target: CollectionTarget; sessionId?: string; cursor: number; inventoryFromFirst?: boolean;
  stamp?: string; layers?: LayerRow[]; metadata?: LayerMetadata;
}

/** The one native page request outstanding for a job. */
export interface CollectionTicket { id: string; generation: number; cursor: number; maxRows: number; began: number; dispatched?: boolean }

/** The native stamp of a page: its ordinals, the stamp as the host reported it and that stamp as JSON text. */
export interface PageStamp { epoch: number; revision: number | null; raw: JsonObject; key: string }

/** A page that passed validation: the facts the sidecar reads from it, and the page itself for the agent. */
export interface CollectionPage {
  raw: JsonObject; sessionId: string; rows: JsonValue[]; nextCursor: number | null; stamp: PageStamp;
  kind: string | undefined; totalItems: number | undefined; metadata: JsonObject | undefined;
  localCreation: JsonObject | undefined; localEffect: JsonObject | undefined;
}

/** A validated row ready to retain: its cache key, the row as reported, the row as stored with its stamp and the stored size. */
export interface RetainedCollectionRow { key: string; source: JsonObject; stored: JsonObject; bytes: number }

/** What the layer pages read so far add up to; `complete` once the whole inventory is held. */
export interface LayerAssembly { layers?: LayerRow[]; metadata?: LayerMetadata; complete: boolean }
