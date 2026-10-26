// The panel's variant card routes: list the held option sets and choose between their candidates. Paired panel only.
import { number, object, string, union, literal } from "@extynt/decode";
import { chooseVariant, jsonOf, listVariantSets, type VariantSet } from "@extynt/mcp-server";
import type { ProjectSnapshot } from "@extynt/project-graph";

import { planCard } from "./agent-plan.js";
import type { AgentPlanCard } from "./agent-types.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { requirePairedPanel } from "./server-paired-panel.js";
import { publishPlans } from "./plans-events.js";
import { uniformBody } from "./server-route-body.js";
import { bodyRoute, ok, rejected, route, type RouteReply, type MountedRoute } from "./server-route-table.js";

const LISTED_SETS = 10;
const CHOOSE_BODY_LIMIT_BYTES = 4_096;
const MAX_SET_ID_CHARS = 128;
const REFUSAL_STATUS: ReadonlyMap<string, number> = new Map([["VARIANT_SET_NOT_FOUND", 404], ["INVALID_ARGUMENT", 422], ["NO_SNAPSHOT", 409]]);
const DEFAULT_REFUSAL_STATUS = 409;

type Composition = ProjectSnapshot["compositions"][number];

interface CompositionView {
  readonly id: Composition["id"];
  readonly name: Composition["name"];
  readonly width: Composition["width"];
  readonly height: Composition["height"];
  readonly duration: Composition["duration"];
  readonly frameRate: Composition["frameRate"];
  readonly currentTime: number | null;
  readonly backgroundColor: Composition["backgroundColor"] | null;
}

interface SetView {
  readonly setId: string;
  readonly status: VariantSet["status"];
  readonly reason: VariantSet["reason"] | null;
  readonly question: string | null;
  readonly names: VariantSet["names"];
  readonly currentValue: VariantSet["currentValue"];
  readonly createdAt: string;
  readonly target: VariantSet["target"];
  readonly candidates: ReadonlyArray<{ readonly index: number; readonly label: string; readonly value: VariantSet["candidates"][number]["value"]; readonly current: boolean }>;
  readonly stale: boolean;
  readonly composition: CompositionView | null;
}

const chooseBody = object({ setId: string({ maxLength: MAX_SET_ID_CHARS }), choice: union(number(), literal("none")) });

function compositionView(latest: ProjectSnapshot | undefined, set: VariantSet): CompositionView | null {
  const composition = latest?.compositions.find((candidate) => candidate.id === set.target.compositionId);
  if (!composition) return null;
  const { id, name, width, height, duration, frameRate } = composition;
  return { id, name, width, height, duration, frameRate, currentTime: composition.currentTime ?? null, backgroundColor: composition.backgroundColor ?? null };
}

function setView(set: VariantSet, latest: ProjectSnapshot | undefined): SetView {
  const { compositionId, layerId, effectPath, propertyPath, effectMatchName } = set.target;
  return {
    setId: set.setId, status: set.status, reason: set.reason ?? null, question: set.question || null, names: set.names, currentValue: set.currentValue, createdAt: set.createdAt,
    target: { compositionId, layerId, effectPath, propertyPath, effectMatchName },
    candidates: set.candidates.map((candidate, index) => ({ index, label: candidate.label, value: candidate.value, current: candidate.current })),
    stale: set.status === "open" && latest?.fingerprint !== set.snapshotFingerprint,
    composition: compositionView(latest, set),
  };
}

interface ChosenView {
  readonly ok: true;
  readonly outcome: "picked" | "kept_current" | "dismissed";
  readonly set: SetView;
  readonly plan?: AgentPlanCard;
  readonly writeAuthorizing: false;
}

interface RefusedView {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
  readonly set?: SetView;
  readonly writeAuthorizing: false;
}

function choose(deps: HttpRoutesDeps, input: { readonly setId: string; readonly choice: number | "none" }): RouteReply<ChosenView | RefusedView> {
  const latest = deps.dispatch.normalizedLatest();
  const outcome = chooseVariant({ plans: deps.state.plans, variants: deps.state.variants, now: deps.state.now }, { ...input, currentFingerprint: latest?.fingerprint ?? null });
  deps.dispatch.notifyChange();
  publishPlans(deps.state, "variants");
  if (!outcome.ok) {
    const refused: RefusedView = { ok: false, error: outcome.error, ...(outcome.set ? { set: setView(outcome.set, latest) } : {}), writeAuthorizing: false };
    return rejected(REFUSAL_STATUS.get(outcome.error.code) ?? DEFAULT_REFUSAL_STATUS, refused, outcome.error.code);
  }
  const plan = outcome.outcome === "picked" ? planCard(jsonOf({ planId: outcome.plan.plan.planId, summary: outcome.plan.plan.summary, presentation: outcome.plan.presentation, plan: outcome.plan.plan }), {}) : undefined;
  return ok({ ok: true, outcome: outcome.outcome, set: setView(outcome.set, latest), ...(plan ? { plan } : {}), writeAuthorizing: false });
}

const requirePanel = requirePairedPanel("Choosing between options requires the paired panel instance.");

/** `GET /v1/variants` lists the held option sets, newest first; `POST /v1/variants/choose` picks one candidate or none. A pick approves nothing itself: it leaves exactly one ordinary plan for the panel to approve and apply, and withdraws the rest. */
export const variantsRoutes: readonly MountedRoute[] = [
  route({ method: "GET", path: "/v1/variants", guard: requirePanel, handle: ({ deps }) => {
    const latest = deps.dispatch.normalizedLatest();
    return ok({ ok: true, sets: listVariantSets({ variants: deps.state.variants }, LISTED_SETS).map((set) => setView(set, latest)), writeAuthorizing: false } as const);
  } }),
  bodyRoute({
    method: "POST",
    path: "/v1/variants/choose",
    guard: requirePanel,
    body: uniformBody(chooseBody, CHOOSE_BODY_LIMIT_BYTES, { status: 400, code: "INVALID_JSON", message: "The request must be a JSON object with a setId and a choice." }),
    handle: ({ deps, body }) => choose(deps, body),
  }),
];
