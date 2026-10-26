// Types that bind every event type to exactly one transition, so the reducer's dispatch table is checked for totality by the compiler.

import type { WorkflowEvent } from "./events.js";
import type { MutableWorkflowState } from "./frozen-state.js";

/** The discriminant of every workflow event. */
export type EventType = WorkflowEvent["type"];

type EventMap = { readonly [Event in WorkflowEvent as Event["type"]]: Event };

/** The event variant carrying the given type. */
export type EventOf<Type extends EventType> = EventMap[Type];

/** The state change one event type causes; it receives a mutable working copy and returns it. */
export type Transition<Type extends EventType> = (next: MutableWorkflowState, event: EventOf<Type>) => MutableWorkflowState;

/** A transition for every event type. */
export type TransitionTable = { readonly [Type in EventType]: Transition<Type> };

/** The slice of the transition table one module owns. */
export type TransitionSlice = { readonly [Type in EventType]?: Transition<Type> };
