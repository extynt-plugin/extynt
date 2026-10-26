// Tool argument specifications: each pairs a decoder with the JSON Schema the model is shown. The decoder checks the kind of every argument; the ranges the schema advertises (limits, lengths, item counts) are answered by the tool itself, in its own words.
import { array, boolean, jsonObject, jsonValue, literal, number, object, optional, string, union } from "@extynt/decode";
import type { AnyDecoder, Decoder, Infer, JsonObject, JsonValue, ObjectOf, OptionalDecoder } from "@extynt/decode";

interface SchemaNote {
  readonly description?: string;
}

interface StringSchema extends SchemaNote {
  readonly type: "string";
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly enum?: ReadonlyArray<string>;
}

interface NumberSchema extends SchemaNote {
  readonly type: "number" | "integer";
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
}

interface BooleanSchema extends SchemaNote {
  readonly type: "boolean";
}

interface ConstSchema extends SchemaNote {
  readonly const: string | number | boolean;
}

interface ArraySchema extends SchemaNote {
  readonly type: "array";
  readonly items: JsonSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
}

interface ObjectSchema extends SchemaNote {
  readonly type: "object";
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: ReadonlyArray<string>;
  readonly additionalProperties?: false;
}

interface OneOfSchema extends SchemaNote {
  readonly oneOf: ReadonlyArray<JsonSchema>;
}

interface UntypedSchema {
  readonly description: string;
}

type JsonSchema = UntypedSchema | StringSchema | NumberSchema | BooleanSchema | ConstSchema | ArraySchema | ObjectSchema | OneOfSchema;

/** The JSON Schema of a tool's arguments: one closed object. */
export interface InputSchema extends ObjectSchema {
  readonly additionalProperties: false;
}

/** A decoder that also knows the JSON Schema describing what it accepts. */
export interface Arg<T> extends Decoder<T> {
  readonly schema: JsonSchema;
}

interface AnyArg extends AnyDecoder {
  readonly schema: JsonSchema;
}

/** An argument that may be absent. */
export interface OptionalArg<T> extends Arg<T>, OptionalDecoder<T> {}

/** The arguments of one object, by key. */
export type ArgShape = Readonly<Record<string, AnyArg>>;

type ArgsOf<S extends ArgShape> = ObjectOf<S>;

interface ArgNote {
  readonly description?: string;
}

interface StringOptions extends ArgNote {
  readonly nonEmpty?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
}

interface NumberOptions extends ArgNote {
  readonly integer?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly exclusiveMin?: number;
}

interface ArrayOptions extends ArgNote {
  readonly minItems?: number;
  readonly maxItems?: number;
}

function withNote<S extends JsonSchema>(schema: S, note: ArgNote): S {
  return note.description === undefined ? schema : { ...schema, description: note.description };
}

function limited<S extends JsonSchema>(schema: S, limits: Readonly<Record<string, number | undefined>>): S {
  const present = Object.entries(limits).filter((entry): entry is [string, number] => entry[1] !== undefined);
  return { ...schema, ...Object.fromEntries(present) };
}

/** A string argument. */
export function stringArg(options: StringOptions = {}): Arg<string> {
  const minLength = options.nonEmpty === true ? Math.max(1, options.minLength ?? 1) : options.minLength;
  const decoder = string();
  const schema: StringSchema = { type: "string", ...(minLength === undefined ? {} : { minLength }), ...(options.maxLength === undefined ? {} : { maxLength: options.maxLength }) };
  return { run: decoder.run, schema: withNote(schema, options) };
}

/** A finite-number argument. */
export function numberArg(options: NumberOptions = {}): Arg<number> {
  const decoder = number(options.integer === true ? { int: true } : {});
  const schema: NumberSchema = limited({ type: options.integer === true ? "integer" : "number" }, { minimum: options.min, maximum: options.max, exclusiveMinimum: options.exclusiveMin });
  return { run: decoder.run, schema: withNote(schema, options) };
}

/** An argument the tool names in its own words when it is absent: it decodes to `undefined`, and the schema still lists it as required. */
export function reportedArg<T>(argument: Arg<T>): Arg<T | undefined> {
  return { run: (input) => (input === undefined ? undefined : argument.run(input)), schema: argument.schema };
}

/** An array argument that a client may also send as JSON text; the tool reads the text and names it when it is not an array. */
export function arrayOrTextArg<T>(argument: Arg<ReadonlyArray<T>>): Arg<ReadonlyArray<T> | string> {
  return { run: union(argument, string()).run, schema: argument.schema };
}

/** A boolean argument. */
export function booleanArg(note: ArgNote = {}): Arg<boolean> {
  return { run: boolean().run, schema: withNote({ type: "boolean" }, note) };
}

/** A string argument that must be one of the given values. */
export function enumArg<const V extends readonly [string, ...string[]]>(values: V, note: ArgNote = {}): Arg<V[number]> {
  return { run: literal(...values).run, schema: withNote({ type: "string", enum: values }, note) };
}

/** An argument that must equal one string constant. */
export function constArg<const V extends string>(value: V): Arg<V> {
  return { run: literal(value).run, schema: { const: value } };
}

/** An array argument whose every item is the given argument. */
export function arrayArg<T>(item: Arg<T>, options: ArrayOptions = {}): Arg<ReadonlyArray<T>> {
  const schema: ArraySchema = limited({ type: "array", items: item.schema }, { minItems: options.minItems, maxItems: options.maxItems });
  return { run: array(item).run, schema: withNote(schema, options) };
}

interface ObjectOptions extends ArgNote {
  readonly open?: boolean;
}

/** An object argument with the shape's keys; keys the shape does not name are ignored, as MCP clients may add their own. */
export function objectArg<S extends ArgShape>(shape: S, note: ObjectOptions = {}): Arg<ArgsOf<S>> {
  const entries = Object.entries(shape);
  const required = entries.filter(([, argument]) => !("optional" in argument)).map(([key]) => key);
  const properties = Object.fromEntries(entries.map(([key, argument]) => [key, argument.schema]));
  const schema: ObjectSchema = { type: "object", properties, ...(required.length > 0 ? { required } : {}), ...(note.open === true ? {} : { additionalProperties: false }) };
  return { run: object(shape).run, schema: withNote(schema, note) };
}

/** An argument made from any decoder and the schema that describes what it accepts. */
export function customArg<T>(decoder: Decoder<T>, schema: JsonSchema): Arg<T> {
  return { run: decoder.run, schema };
}

/** An argument of any JSON type, described only in words. */
export function jsonArg(description: string): Arg<JsonValue> {
  return { run: jsonValue.run, schema: { description } };
}

/** An object argument whose contents are not described to the model; it arrives as a JSON object. */
export function freeObjectArg(note: ArgNote = {}): Arg<JsonObject> {
  return { run: jsonObject.run, schema: withNote({ type: "object" }, note) };
}

/** An argument that matches the first of several shapes, tried in order. */
export function unionArg<const V extends readonly [AnyArg, ...AnyArg[]]>(variants: V, note: ArgNote = {}): Arg<Infer<V[number]>> {
  return { run: union(...variants).run, schema: withNote({ oneOf: variants.map((variant) => variant.schema) }, note) };
}

/** An argument that may be absent from its object. */
export function optionalArg<T>(argument: Arg<T>): OptionalArg<T> {
  return { run: optional(argument).run, optional: true, schema: argument.schema };
}

/** The whole input of one tool: its decoder and the closed JSON Schema the model is shown. */
export interface ToolInput<S extends ArgShape> {
  readonly decoder: Decoder<ArgsOf<S>>;
  readonly schema: InputSchema;
}

/** Builds a tool's input from its argument shape. */
export function toolInput<S extends ArgShape>(shape: S): ToolInput<S> {
  const entries = Object.entries(shape);
  const required = entries.filter(([, argument]) => !("optional" in argument)).map(([key]) => key);
  const properties = Object.fromEntries(entries.map(([key, argument]) => [key, argument.schema]));
  const schema: InputSchema = { type: "object", properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false };
  return { decoder: object(shape), schema };
}
