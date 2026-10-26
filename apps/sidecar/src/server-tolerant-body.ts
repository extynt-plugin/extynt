// The body of a request whose body is optional: when it is missing, too large or not what the decoder wants, the request is answered as if it had sent the blank body.
import type { IncomingMessage } from "node:http";
import { decodeJson, type Decoder } from "@extynt/decode";

import { readBody } from "./server-http-wire.js";

/** Reads the request body within `maxBytes` and decodes it. An empty body reads as `{}`; any failure yields `blank`. */
export async function tolerantBody<Body>(request: IncomingMessage, maxBytes: number, decoder: Decoder<Body>, blank: Body): Promise<Body> {
  try {
    const decoded = decodeJson((await readBody(request, maxBytes)) || "{}", decoder);
    return decoded.ok ? decoded.value : blank;
  } catch {
    return blank;
  }
}
