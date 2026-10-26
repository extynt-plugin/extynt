// The transform properties a layer's animation may name, the table the property decision chooses from.
import type { PropertyCandidate } from "@extynt/decide";
/** The transform properties of every layer, keyed by role. */
export const TRANSFORM_PROPERTIES: ReadonlyArray<PropertyCandidate> = [
  { key: "transform.opacity", title: "Opacity", group: "Transform" },
  { key: "transform.scale", title: "Scale", group: "Transform" },
  { key: "transform.rotation", title: "Rotation", group: "Transform" },
  { key: "transform.position", title: "Position", group: "Transform" },
  { key: "transform.anchor", title: "Anchor Point", group: "Transform" },
];
