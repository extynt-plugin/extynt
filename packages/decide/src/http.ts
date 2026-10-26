// The slice of fetch the network adapters use, so tests can supply a fake and the global fetch still fits.

/** The request an adapter sends. */
export interface HttpRequest {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
}

/** The part of a response an adapter reads: the status and the body text. */
export interface HttpReply {
  readonly status: number;
  text(): Promise<string>;
}

/** A fetch function; the global `fetch` satisfies it. */
export type HttpFetch = (url: string, request: HttpRequest) => Promise<HttpReply>;
