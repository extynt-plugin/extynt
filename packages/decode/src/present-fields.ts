// Builds an object from fields in which `undefined` means absent, with a type that says which keys may be missing.
import { assertDecoded } from "./trust.js";

type Flatten<T> = { [K in keyof T]: T[K] };
type MaybeAbsent<Fields> = { [K in keyof Fields]: undefined extends Fields[K] ? K : never }[keyof Fields];

/** The type of `presentFields`: keys that may hold `undefined` become optional keys without `undefined`; the rest stay required. */
export type Present<Fields> = Flatten<
  { readonly [K in Exclude<keyof Fields, MaybeAbsent<Fields>>]: Fields[K] } & { readonly [K in MaybeAbsent<Fields>]?: Exclude<Fields[K], undefined> }
>;

/** A copy of the fields without the keys that hold `undefined`, as `JSON.stringify` would write it; use it to build objects that satisfy `exactOptionalPropertyTypes`. */
export function presentFields<Fields extends Readonly<Record<string, Field>>, Field = Fields[string]>(fields: Fields): Present<Fields> {
  const present = Object.fromEntries(Object.entries(fields).filter(([, field]) => field !== undefined));
  assertDecoded<Present<Fields>>(present);
  return present;
}
