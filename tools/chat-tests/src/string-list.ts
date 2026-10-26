/** A decoder for the JSON arrays of strings the harness reads in several places. */
import { array, map, string } from "@extynt/decode";
import type { Decoder } from "@extynt/decode";

/** An array whose every item is a string, as a mutable array. */
export const stringList: Decoder<string[]> = map(array(string()), (items) => [...items]);
