// The JSON value type a decision's state is made of, so every state can be sent to a decision model as it is.

/** Any value JSON can carry; a decision's state is one of these. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };
