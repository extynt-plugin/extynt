// The ae_ask_user font guard: a question about a font the complete census lacks is refused, and the model is told to use the installed substitute instead. A partial census never refuses, and an insisted-on exact font lets the question through.
import { fontsAreAuthoritative } from "@extynt/capability-catalogue";
import type { FontRecord, HostCapabilityProfile } from "@extynt/capability-catalogue";
import { faceFor, familyLook, hasFontCue, knownFamiliesNamedIn, missingNamedFont, styleAskedIn, substituteFamilies } from "@extynt/decide";
import type { callTool } from "@extynt/mcp-server";

type GuardResult = ReturnType<typeof callTool>;

const EXACT_FONT_INSISTED = /\b(?:exact|exactly|precise|precisely)\s+(?:font|typeface)\b|\binsist\w*|\bno substitut\w*|\bdon'?t substitute\b|\bnot a substitute\b/iu;

const FALLBACK_OFFER = "No installed family fits; ask about the layer's default font instead.";

const refuse = (message: string): GuardResult => ({ ok: false, error: { code: "ASK_FONT_NOT_INSTALLED", message } });

function absentFamilies(items: readonly FontRecord[], question: string): string[] {
  const installed = new Set(items.map((record) => record.family.toLowerCase()));
  return knownFamiliesNamedIn(question).filter((name) => !installed.has(name));
}

function alternativesOffer(items: readonly FontRecord[], first: string): string {
  const alternatives = substituteFamilies(familyLook(first) || first, items);
  return alternatives.length ? `Installed alternatives, the only families to name: ${alternatives.join(", ")}.` : FALLBACK_OFFER;
}

function substituteOffer(items: readonly FontRecord[], request: string): string {
  const [best, ...others] = substituteFamilies(request, items);
  if (best === undefined) return "No installed family fits its look: omit font to keep the layer's default, and say so in your reply.";
  const face = faceFor(items, best, styleAskedIn(request));
  const picked = face ? `${best} as ${face.record.postScriptName} (${face.record.style})` : best;
  const alternatives = others.length ? ` Alternatives, all installed: ${others.join(", ")}.` : "";
  return `Use the installed substitute ${picked} and say so in your reply.${alternatives}`;
}

function missingRequestRefusal(items: readonly FontRecord[], question: string, request: string): GuardResult | undefined {
  if (!hasFontCue(question)) return undefined;
  const named = missingNamedFont(request, items);
  if (named === undefined) return undefined;
  return refuse(`Do not ask which font to use: "${named.name}" is not installed on this host. ${substituteOffer(items, request)} Ask again only about what the font does not decide.`);
}

/** The refusal for a question about an uninstalled font, or undefined when the question may be asked. Refused when it names an uninstalled family, or when this turn's request names an uninstalled font and the question is about a font. */
export function fontQuestionRefusal(profile: HostCapabilityProfile | undefined, question: string, request: string): GuardResult | undefined {
  const inventory = profile?.fontInventory;
  if (!inventory || !fontsAreAuthoritative(inventory) || EXACT_FONT_INSISTED.test(request)) return undefined;
  const missing = missingRequestRefusal(inventory.items, question, request);
  if (missing) return missing;
  const absent = absentFamilies(inventory.items, question);
  const [first] = absent;
  if (first === undefined) return undefined;
  return refuse(`Not installed on this host: ${absent.join(", ")}. ${alternativesOffer(inventory.items, first)} Ask again naming only installed families.`);
}

const DISCLOSURE_ALTERNATIVES = 3;

/** The note that goes with a completion when the request named a typeface the complete census lacks: the reply must say it is missing, name the stand-in and offer installed alternatives; undefined when nothing is missing or the census is partial. */
export function fontDisclosure(profile: HostCapabilityProfile | undefined, request: string): string | undefined {
  const inventory = profile?.fontInventory;
  if (!inventory || !fontsAreAuthoritative(inventory)) return undefined;
  const named = missingNamedFont(request, inventory.items);
  if (named === undefined) return undefined;
  const alternatives = substituteFamilies(request, inventory.items).slice(0, DISCLOSURE_ALTERNATIVES);
  const offer = alternatives.length ? `offer the closest installed alternatives (${alternatives.join(", ")}; ae_search_fonts finds more)` : "offer to look for alternatives with ae_search_fonts";
  return `The request named "${named.name}", which is not installed on this host. Your reply must say so, name the font you used instead, and ${offer}. Never present the stand-in as the font that was asked for.`;
}
