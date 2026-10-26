/** The shapes of catalogue text: a plain message or a plural one, the named placeholders both may hold, and the typed parameters a key demands. */

/** A message whose wording depends on a count: `one` for a count the language reads as singular, `other` for the rest. Both may use {count}. */
export interface PluralMessage {
  readonly one: string;
  readonly other: string;
}

/** One entry of the English source. */
export type Message = string | PluralMessage;

/** A translation of a plural message: languages without a singular (Japanese, Chinese) give only `other`. */
export interface PluralTranslation {
  readonly one?: string;
  readonly other: string;
}

/** One entry of any language's catalogue. */
export type Entry = string | PluralTranslation;

/** The translation of a catalogue: every key of the English source, plain text for plain text and a plural for a plural. */
export type Translation<Source extends Readonly<Record<string, Message>>> = {
  readonly [Key in keyof Source]: Source[Key] extends string ? string : PluralTranslation;
};

type TextOf<Entry extends Message> = Entry extends string ? Entry : Entry extends PluralMessage ? Entry["one"] | Entry["other"] : never;

type Names<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}` ? Name | Names<Rest> : never;

type Fields<Entry extends Message> = { readonly [Name in Names<TextOf<Entry>>]: Name extends "count" ? number : string | number };

/** The arguments after the key: none for text without placeholders, one object naming every placeholder otherwise. */
export type ParamsOf<Entry extends Message> = [Names<TextOf<Entry>>] extends [never] ? [] : [params: Fields<Entry>];

/** The values a message is filled with, as the lookup sees them. */
export type FillValues = Readonly<Record<string, string | number>>;

/** One group of the catalogue in all six languages: the English source and a full translation of it into each other language. */
export type DomainText<Source extends Readonly<Record<string, Message>>> = {
  readonly en: Source;
  readonly es: Translation<Source>;
  readonly de: Translation<Source>;
  readonly fr: Translation<Source>;
  readonly ja: Translation<Source>;
  readonly "zh-Hans": Translation<Source>;
};
