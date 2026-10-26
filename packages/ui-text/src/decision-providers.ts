// Which decision-model providers exist and which advanced fields each one asks for, shared by the panel and the sidecar's key page.

/** The providers: Jev (the TypeSafe shorthand), an OpenAI-compatible server, Cloudflare Workers AI and a System One server. */
export const DECISION_PROVIDERS = ["jev", "openai", "cloudflare", "systemone"] as const;

/** One of the providers the settings can set up. */
export type DecisionProvider = (typeof DECISION_PROVIDERS)[number];

/** The advanced fields a provider can ask for. */
export type DecisionField = "model" | "baseUrl" | "accountId";

/** The advanced fields each provider asks for: a model everywhere, an address where the server varies, an account only for Cloudflare. */
export const DECISION_PROVIDER_FIELDS: Readonly<Record<DecisionProvider, ReadonlyArray<DecisionField>>> = {
  jev: ["model", "baseUrl"],
  openai: ["model", "baseUrl"],
  cloudflare: ["model", "accountId"],
  systemone: ["model", "baseUrl"],
};

/** Whether a provider asks for the field. */
export function providerAsksFor(provider: DecisionProvider, field: DecisionField): boolean {
  return DECISION_PROVIDER_FIELDS[provider].includes(field);
}

/** The providers that ask for the field. */
export function providersAskingFor(field: DecisionField): ReadonlyArray<DecisionProvider> {
  return DECISION_PROVIDERS.filter((provider) => providerAsksFor(provider, field));
}
