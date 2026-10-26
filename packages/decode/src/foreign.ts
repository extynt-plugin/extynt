// Reaching into a module loaded by path, and into what it returns, one named step at a time: each step is checked and each result is decoded by the caller.
import { DecodeFailure, decodeOrThrow } from "./decoder.js";
import type { Decoder } from "./decoder.js";
import { kindOf } from "./failure.js";

function refusal(path: string, expected: string, found: unknown): DecodeFailure {
  const shown = kindOf(found);
  return new DecodeFailure({ path, expected, found: shown, message: `${path}: expected ${expected}, found ${shown}` });
}

/** A value from code loaded at run time: read, called and constructed by name (each step refused when it does not fit), typed only through a decoder. */
export class Foreign {
  private readonly held: unknown;
  private readonly path: string;

  constructor(held: unknown, path = "$") {
    this.held = held;
    this.path = path;
  }

  read(name: string): Foreign {
    const holder = this.held;
    if ((typeof holder !== "object" && typeof holder !== "function") || holder === null) throw refusal(this.path, "an object", holder);
    return new Foreign(Reflect.get(holder, name), `${this.path}.${name}`);
  }

  hasFunction(name: string): boolean {
    return this.read(name).isFunction();
  }

  ensureFunction(): Foreign {
    if (typeof this.held !== "function") throw refusal(this.path, "a function", this.held);
    return this;
  }

  isUndefined(): boolean {
    return this.held === undefined;
  }

  isFunction(): boolean {
    return typeof this.held === "function";
  }

  invoke(name: string, args: ReadonlyArray<unknown>): Foreign {
    const member = this.read(name);
    const target = member.held;
    if (typeof target !== "function") throw refusal(member.path, "a function", target);
    return new Foreign(Reflect.apply(target, this.held, args), `${member.path}()`);
  }

  construct(args: ReadonlyArray<unknown>): Foreign {
    const target = this.held;
    if (typeof target !== "function") throw refusal(this.path, "a function", target);
    return new Foreign(Reflect.construct(target, args), `new ${this.path}`);
  }

  apply(args: ReadonlyArray<unknown>): Foreign {
    const target = this.held;
    if (typeof target !== "function") throw refusal(this.path, "a function", target);
    return new Foreign(Reflect.apply(target, undefined, args), `${this.path}()`);
  }

  into<T>(decoder: Decoder<T>): T {
    return decodeOrThrow(decoder, this.held);
  }

  async intoAwaited<T>(decoder: Decoder<T>): Promise<T> {
    return decodeOrThrow(decoder, await this.held);
  }
}

/** Imports the module at the address and checks that each named export is a function; refused naming the export that is not. */
export async function importFunctions(url: string, names: ReadonlyArray<string>): Promise<Foreign> {
  const namespace = new Foreign(await import(url), url);
  for (const name of names) namespace.read(name).ensureFunction();
  return namespace;
}
