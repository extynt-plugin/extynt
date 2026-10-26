// Decoders and types for what the watch connection carries: the `watch_state` body, the subscription handshake and the event lines.
import { literal, number, object, string, taggedUnion } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { absentAsNull, list } from "./wire-common.js";

export const CHANGE_REASONS = ["project", "revision", "active", "selection", "time", "initial"] as const;
export type ChangeReason = typeof CHANGE_REASONS[number];

const watchStateShape = {
  epoch: number(), revision: absentAsNull(number()), items: absentAsNull(number()),
  projectName: string(), projectPath: absentAsNull(string()),
  activeCompId: absentAsNull(string()), activeCompName: absentAsNull(string()), time: absentAsNull(number()),
  selection: list(string()), selectedLayers: list(object({ id: string(), index: number(), name: string() })),
};

/** The body of a `change` event, which is also the result of `watch_state`; an absent nullable member reads as null. */
export const watchState = object(watchStateShape);
export type WatchState = Infer<typeof watchState>;

/** The result of the `watch` request: the intervals the plugin settled on. */
export const watchSubscribed = object({ subscribed: literal(true), intervalMs: number(), stillMs: number() });
export type WatchSubscribed = Infer<typeof watchSubscribed>;

/** One event line; an event name it does not know, or a member of the wrong type, is rejected. */
export const pluginEvent = taggedUnion("event", {
  change: object({ event: literal("change"), seq: number(), at: number(), reason: list(literal(...CHANGE_REASONS)), ...watchStateShape }),
  still: object({ event: literal("still"), seq: number(), at: number(), epoch: number(), revision: absentAsNull(number()) }),
  overflow: object({ event: literal("overflow"), dropped: number() }),
  "host-closing": object({ event: literal("host-closing"), seq: number(), at: number(), reason: literal("death-hook") }),
});
export type PluginEvent = Infer<typeof pluginEvent>;
