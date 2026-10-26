/**
 * A bare ExtendScript global scope with the host files loaded, plus typed reads of what a vm-hosted context exposes. Every
 * result is checked by a guard or carried as JSON text, so no test casts a value that crossed the vm boundary.
 */

import vm from "node:vm";
import { decode, string, type Decoder, type JsonObject, type JsonValue } from "@extynt/decode";
import { fieldOf, readJson, recordOf, textOf, type Found } from "./json-narrow.js";
import { loadHostFiles } from "./host-sources.js";

/** The JSON-safe value an expression evaluates to inside the context; `undefined` when it evaluates to nothing. */
export function evaluateJson(context: vm.Context, expression: string): Found {
  const text = String(vm.runInContext(`JSON.stringify({ value: ${expression} })`, context));
  return fieldOf(readJson(text), "value");
}

/** The vm context and a `call` that evaluates an expression inside it and returns the JSON-safe result. */
export interface HostContext {
  readonly context: vm.Context;
  call(expression: string): Found;
}

/** `globals` are the host objects the function under test touches; everything else stays undefined, as in a minimal host. */
export function loadHostContext(globals: vm.Context = {}): HostContext {
  const context = vm.createContext({ $: { sleep: () => undefined }, ...globals });
  loadHostFiles(context, "probe.jsx");
  return { context, call: (expression) => evaluateJson(context, expression) };
}

/** Accepts a value read from the fake host when it is text. */
export const isText: Decoder<string> = string();

/** The global `name` of the context when `isExpected` accepts it; anything else throws. */
export function hostGlobal<Expected>(context: vm.Context, name: string, expected: Decoder<Expected>): Expected {
  const found = decode(expected, vm.runInContext(name, context));
  if (!found.ok) throw new TypeError(`the host global ${name} is not the expected shape`);
  return found.value;
}

/** The JSON value an expression evaluated in the host returns; an expression with no value throws. */
export function callJson(host: HostContext, expression: string): JsonValue {
  const value = host.call(expression);
  if (value === undefined) throw new TypeError(`the host expression ${expression} returned nothing`);
  return value;
}

/** The object a host entry point returns as JSON text for the given request text. */
export function callEntry(host: HostContext, entry: string, raw: string): JsonObject {
  return recordOf(readJson(textOf(callJson(host, `${entry}(${JSON.stringify(raw)})`))));
}

/** Puts a fake object into the context as the global `name`, for a test that changes what the host sees. */
export function installGlobal<Fake>(context: vm.Context, name: string, fake: Fake): void {
  Reflect.set(context, name, fake);
}
