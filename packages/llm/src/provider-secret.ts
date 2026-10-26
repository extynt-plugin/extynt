/** Where a provider's API key comes from and how it is sent: the server environment or a rotatable in-memory input, with no credential header for a keyless server. */
import { env as processEnv } from "node:process";

export type AuthSource = "server-environment" | "local-secret-input";

/** `keyless` is true for a server that takes no key (local Ollama, an open gateway): requests then carry no credential header. */
export interface SecretSource {
  readonly authSource: AuthSource;
  resolve(): string | undefined;
  readonly keyless?: boolean;
}

export interface RotatableLocalSecret extends SecretSource {
  readonly authSource: "local-secret-input";
  replace(secret: string): void;
  clear(): void;
}

/** The key a request sends, or "" for a keyless server; a keyed provider with no key is an error. */
export function requestCredential(source: SecretSource): string {
  const key = source.resolve();
  if (key) return key;
  if (source.keyless === true) return "";
  throw new Error("The configured provider secret is unavailable.");
}

/** The Anthropic counterpart of `bearerHeader`: no `x-api-key` for a keyless server. */
export function apiKeyHeader(apiKey: string): Record<string, string> {
  return apiKey ? { "x-api-key": apiKey } : {};
}

/** Authorization only when there is a key: a keyless server never sees `Bearer ` with nothing after it. */
export function bearerHeader(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export function createServerEnvironmentSecret(environment: Readonly<Record<string, string | undefined>> = processEnv, variable = "OPENAI_API_KEY"): SecretSource {
  return { authSource: "server-environment", resolve: () => environment[variable] };
}

/** Keeps a BYOK value in server memory; callers must not serialize this object. */
export function createLocalSecretInput(secret: string): RotatableLocalSecret {
  let current = secret;
  return {
    authSource: "local-secret-input",
    resolve: () => current || undefined,
    replace: (next) => { current = next; },
    clear: () => { current = ""; },
  };
}
