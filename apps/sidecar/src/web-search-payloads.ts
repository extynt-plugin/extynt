// What a search provider's reply says, decoded once into sources, answer text and a search count: read from the structured result blocks, never the prose.
import { array, type Decoder, fallback, type Infer, map, number, string } from "@extynt/decode";
import { lenientObject } from "./server-mcp-arguments.js";

/** The two search dialects: Anthropic's Messages surface and OpenAI's Responses API. */
export type SearchDialect = "anthropic" | "openai";

/** One cited page; `pageAge` is the provider's own words for how old it is. */
export interface WebSource {
  readonly title: string;
  readonly url: string;
  readonly pageAge?: string;
}

interface SearchRead {
  readonly sources: readonly WebSource[];
  readonly answer: string;
  readonly searched: number;
}

interface Harvest {
  readonly sources: WebSource[];
  readonly texts: string[];
  readonly seen: Set<string>;
  searched: number;
}

const MAX_URL_CHARS = 600;
const MAX_TITLE_CHARS = 200;
const MAX_PAGE_AGE_CHARS = 40;

const words = fallback(string(), undefined);
const hit = lenientObject({ title: words, url: words, page_age: words });
const anthropicBlock = lenientObject({ type: words, text: words, content: fallback(array(hit), undefined) });
const requestCount = lenientObject({ web_search_requests: fallback(number(), undefined) });
const anthropicReply = lenientObject({
  content: fallback(array(anthropicBlock), undefined),
  usage: fallback(lenientObject({ server_tool_use: fallback(requestCount, undefined) }), undefined),
});
const citation = lenientObject({ type: words, url: words, title: words });
const openAiPart = lenientObject({ type: words, text: words, annotations: fallback(array(citation), undefined) });
const openAiItem = lenientObject({ type: words, content: fallback(array(openAiPart), undefined) });
const openAiReply = lenientObject({ output: fallback(array(openAiItem), undefined) });

function blank(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}

function pageOf(address: string | undefined, title: string | undefined, age: string | undefined): WebSource | undefined {
  const url = (address ?? "").trim().slice(0, MAX_URL_CHARS);
  if (!url) return undefined;
  const pageAge = blank(age)?.slice(0, MAX_PAGE_AGE_CHARS);
  return { title: blank(title)?.slice(0, MAX_TITLE_CHARS) ?? url, url, ...(pageAge ? { pageAge } : {}) };
}

function newHarvest(): Harvest {
  return { sources: [], texts: [], seen: new Set<string>(), searched: 0 };
}

function takePage(harvest: Harvest, page: WebSource | undefined): void {
  if (!page || harvest.seen.has(page.url)) return;
  harvest.seen.add(page.url);
  harvest.sources.push(page);
}

function takeHits(harvest: Harvest, hits: ReadonlyArray<Infer<typeof hit>>, maxResults: number): void {
  for (const found of hits) {
    takePage(harvest, pageOf(found.url, found.title, found.page_age));
    if (harvest.sources.length >= maxResults) return;
  }
}

function takeCitations(harvest: Harvest, citations: ReadonlyArray<Infer<typeof citation>>): void {
  for (const cited of citations) {
    if (cited.type === "url_citation") takePage(harvest, pageOf(cited.url, cited.title, undefined));
  }
}

function readAnthropicBlock(harvest: Harvest, block: Infer<typeof anthropicBlock>, maxResults: number): void {
  if (block.type === "text" && block.text !== undefined) harvest.texts.push(block.text.trim());
  if (block.type !== "web_search_tool_result") return;
  harvest.searched += 1;
  takeHits(harvest, block.content ?? [], maxResults);
}

function reportedSearches(reply: Infer<typeof anthropicReply>, counted: number): number {
  const reported = reply.usage?.server_tool_use?.web_search_requests;
  return reported !== undefined && reported > counted ? reported : counted;
}

function readAnthropic(reply: Infer<typeof anthropicReply>, maxResults: number): SearchRead {
  const harvest = newHarvest();
  for (const block of reply.content ?? []) {
    readAnthropicBlock(harvest, block, maxResults);
    if (harvest.sources.length >= maxResults) break;
  }
  return { sources: harvest.sources, answer: harvest.texts.join("\n"), searched: reportedSearches(reply, harvest.searched) };
}

function readOpenAiMessage(harvest: Harvest, parts: ReadonlyArray<Infer<typeof openAiPart>>, maxResults: number): void {
  for (const part of parts) {
    if (part.type === "output_text" && part.text !== undefined) harvest.texts.push(part.text.trim());
    takeCitations(harvest, part.annotations ?? []);
    if (harvest.sources.length >= maxResults) return;
  }
}

function readOpenAi(reply: Infer<typeof openAiReply>, maxResults: number): SearchRead {
  const harvest = newHarvest();
  for (const item of reply.output ?? []) {
    if (item.type === "web_search_call") harvest.searched += 1;
    if (item.type === "message") readOpenAiMessage(harvest, item.content ?? [], maxResults);
    if (harvest.sources.length >= maxResults) break;
  }
  return { sources: harvest.sources, answer: harvest.texts.join("\n"), searched: harvest.searched };
}

const REPLY_DECODERS: Readonly<Record<SearchDialect, (maxResults: number) => Decoder<SearchRead>>> = {
  anthropic: (maxResults) => map(anthropicReply, (reply) => readAnthropic(reply, maxResults)),
  openai: (maxResults) => map(openAiReply, (reply) => readOpenAi(reply, maxResults)),
};

/** A decoder for a provider's reply in the given dialect: it never rejects, and a reply of any other shape reads as no sources, no answer and no searches. At most `maxResults` sources are kept. */
export function searchReplyDecoder(dialect: SearchDialect, maxResults: number): Decoder<SearchRead> {
  return REPLY_DECODERS[dialect](maxResults);
}
