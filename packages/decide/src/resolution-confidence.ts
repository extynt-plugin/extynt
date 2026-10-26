// How sure the offline resolvers are of a pick among candidates, read from the score margin between the best and second-best candidate, how many request concepts the pick explains, and whether a "none" is positive evidence or only a failure to understand the request.
import type { FontStanding } from "./resolution-fonts.js";
import type { Standing } from "./resolution-score.js";

const NO_KEY = "none";

const FULL_SCORE = 4;

const EXPLAINED_FLOOR = 0.5;

const DECISIVE = 0.9;

const OTHER_KIND_TIE = 0.7;

const UNDERSTOOD_NOTHING = 0.3;

const NO_OVERLAP = 0.2;

const AMBIGUOUS = 0.3;

const WEAK = 0.4;

const FULL_NAME_MARGIN = 0.25;

const FULL_LOOK_MARGIN = 0.3;

const LOOK_FLOOR = 0.85;

const unit = (value: number): number => Math.min(1, Math.max(0, value));

function pickedConfidence(standing: Standing): number {
  const strength = unit(standing.top / FULL_SCORE);
  const lead = unit((standing.top - standing.second) / Math.max(standing.top, 1));
  const explained = standing.content === 0 ? 1 : standing.covered / standing.content;
  return (0.5 * strength + 0.5 * lead) * (EXPLAINED_FLOOR + (1 - EXPLAINED_FLOOR) * explained);
}

function nothingConfidence(standing: Standing): number {
  if (standing.denied > 0) return DECISIVE;
  if (standing.content === 0) return UNDERSTOOD_NOTHING;
  if (!standing.anchored) return NO_OVERLAP;
  if (standing.tied) return standing.sameFamily ? AMBIGUOUS : OTHER_KIND_TIE;
  return WEAK;
}

/** The confidence of the pick the scorer made: a clear winner is sure by its strength and lead; "none" is sure when the request denies, or names something no candidate is, and unsure when it understood no word or the candidates are too close or too weak. */
export function standingConfidence(standing: Standing): number {
  if (standing.empty) return DECISIVE;
  return standing.key === NO_KEY ? nothingConfidence(standing) : pickedConfidence(standing);
}

function namedConfidence(standing: FontStanding): number {
  return unit(standing.strength) * (0.6 + 0.4 * unit(standing.margin / FULL_NAME_MARGIN)) * unit(standing.look);
}

function lookConfidence(standing: FontStanding): number {
  return unit((standing.strength - LOOK_FLOOR) / (1 - LOOK_FLOOR)) * (0.5 + 0.5 * unit(standing.margin / FULL_LOOK_MARGIN));
}

function noFontConfidence(standing: FontStanding): number {
  if (standing.tokens === 0 || standing.strength === 0) return UNDERSTOOD_NOTHING;
  return WEAK;
}

/** The confidence of a font pick: a family named outright is sure by how well it matched, how far ahead of the next family it is and how well its style fits the look asked for; a look is sure only when it fits nearly fully; and "none" is unsure when the request understood no word or only part of a look. */
export function fontConfidence(standing: FontStanding): number {
  if (standing.via === "name") return namedConfidence(standing);
  return standing.via === "look" ? lookConfidence(standing) : noFontConfidence(standing);
}
