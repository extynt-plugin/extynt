// The bridge between request pre-resolution and the learned aliases: a clause a model settled before is answered from the store while its entry is still offered, and what a model settles now is learned for next time.
import type { HostCapabilityProfile } from "@extynt/capability-catalogue";
import type { LearnedAliases } from "./learned-aliases.js";
import type { ResolvedTerm, ResolveSources, TermKind } from "./decision-resolve-terms.js";

/** The store and the After Effects version its aliases are valid for. */
export interface AliasScope {
  readonly aliases: LearnedAliases;
  readonly catalogue: string;
}

interface Split {
  readonly terms: ResolvedTerm[];
  readonly left: string[];
}

function catalogueOf(profile: HostCapabilityProfile | undefined): string | undefined {
  return profile === undefined ? undefined : `${profile.host.version}.${profile.host.buildNumber ?? ""}`;
}

/** The alias scope of a request, or undefined when there is no store or no known After Effects version to tie aliases to. */
export function aliasScopeOf(sources: ResolveSources): AliasScope | undefined {
  const catalogue = catalogueOf(sources.profile);
  return sources.aliases === undefined || catalogue === undefined ? undefined : { aliases: sources.aliases, catalogue };
}

/** Answers each clause from a learned alias whose entry is still among the offered ones (key to display name); a stale alias is a miss. */
export function splitLearned(scope: AliasScope | undefined, about: { readonly kind: TermKind; readonly scope?: string }, clauses: readonly string[], offered: ReadonlyMap<string, string>): Split {
  const terms: ResolvedTerm[] = [];
  const left: string[] = [];
  for (const clause of clauses) {
    const answer = scope?.aliases.lookup({ kind: about.kind, catalogue: scope.catalogue, scope: about.scope ?? "", phrase: clause });
    const name = answer === undefined ? undefined : offered.get(answer);
    if (answer === undefined || name === undefined) left.push(clause);
    else terms.push({ kind: about.kind, phrase: clause, scope: about.scope ?? "", key: answer, name, band: "learned", taught: false });
  }
  return { terms, left };
}

/** Learns every term a model settled with confidence. */
export function learnTerms(scope: AliasScope | undefined, terms: readonly ResolvedTerm[]): void {
  if (scope === undefined) return;
  for (const term of terms) {
    if (term.taught && term.kind !== "layer") scope.aliases.learn({ kind: term.kind, catalogue: scope.catalogue, scope: term.scope, phrase: term.phrase }, term.key);
  }
}
