// The one-time key-entry links: a random token in the path, valid for ten minutes, ten tries, used up by the first successful save.
import { randomBytes } from "node:crypto";
import type { DecisionProvider } from "./decision-providers.js";
import type { DecisionShadow } from "./decision-settings-service.js";

/** How long a link works. */
export const KEY_LINK_LIFETIME_MS = 10 * 60_000;

const MAX_OPEN_LINKS = 8;
const TOKEN_BYTES = 24;

/** How many tries a link allows before it stops taking keys. */
export const KEY_LINK_ATTEMPTS = 10;

/** What a successful save left behind, for the page that confirms it. */
export interface KeyAccepted {
  readonly provider: DecisionProvider;
  readonly ms: number;
  readonly shadowed: ReadonlyArray<DecisionShadow>;
}

interface KeyLink {
  readonly provider: DecisionProvider | null;
  readonly expiresAt: number;
  attempts: number;
  accepted: KeyAccepted | null;
}

interface KeyLinks {
  issue(provider: DecisionProvider | null): { readonly token: string; readonly expiresAt: string };
  peek(token: string): Readonly<KeyLink> | null;
  attempt(token: string): boolean;
  accept(token: string, accepted: KeyAccepted): void;
}

/** Creates an empty store; `now` is the clock in milliseconds. */
export function createKeyLinks(now: () => number): KeyLinks {
  const open = new Map<string, KeyLink>();
  const prune = () => {
    for (const [token, link] of open) if (link.expiresAt <= now()) open.delete(token);
    while (open.size >= MAX_OPEN_LINKS) {
      const oldest = open.keys().next().value;
      if (oldest === undefined) return;
      open.delete(oldest);
    }
  };
  const live = (token: string): KeyLink | null => {
    const link = open.get(token);
    if (link === undefined) return null;
    if (link.expiresAt > now()) return link;
    open.delete(token);
    return null;
  };
  return {
    issue: (provider) => {
      prune();
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const expiresAt = now() + KEY_LINK_LIFETIME_MS;
      open.set(token, { provider, expiresAt, attempts: 0, accepted: null });
      return { token, expiresAt: new Date(expiresAt).toISOString() };
    },
    peek: live,
    attempt: (token) => {
      const link = live(token);
      if (link === null || link.accepted !== null || link.attempts >= KEY_LINK_ATTEMPTS) return false;
      link.attempts += 1;
      return true;
    },
    accept: (token, accepted) => {
      const link = live(token);
      if (link !== null) link.accepted = accepted;
    },
  };
}

const stores = new WeakMap<WeakKey, KeyLinks>();

/** The one link store of a sidecar. */
export function keyLinksFor(state: WeakKey, now: () => number): KeyLinks {
  const existing = stores.get(state);
  if (existing !== undefined) return existing;
  const created = createKeyLinks(now);
  stores.set(state, created);
  return created;
}
