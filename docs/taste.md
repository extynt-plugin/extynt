# Taste

[Coding rules](coding-rules.md) say what the gate refuses. This page says what we find beautiful, which is the reason
for most of those rules and the standard for everything the gate cannot measure. A change that passes the gate and
ignores this page is not finished. Every example below is real code in this repository.

## Decode at the edge, then trust the type

Data enters the program at a few places: HTTP, MCP calls, the plugin protocol, ExtendScript results, model replies,
files, the environment. Each place decodes once with `@extynt/decode` into an exact type. Inside, there is no
`unknown`, no cast, no second check.

```ts
// Good: apps/sidecar/src/agent-failure.ts:23-24, 63-67. The shape is the decoder; the type is inferred from it.
const RESPONSE_ERROR_BODY = object({ error: object({ code: string() }) });

function responseErrorCode(detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined;
  const body = decodeJson(detail, RESPONSE_ERROR_BODY);
  return body.ok ? body.value.error.code : undefined;
}
```

```ts
// Bad: the type is a promise nobody checked.
const body = JSON.parse(detail) as { error: { code: string } };
return body.error?.code;
```

A branded identifier says what the string is and refuses to be mixed up with another (`packages/decode/src/brand.ts:6-15`).
The one place that must assert a decoded type is the decoder library itself, in one named function
(`assertDecoded`, called at `brand.ts:21`), so the rest of the code never needs to.

## Names say what a thing is now

A name is the domain's word for the thing, today. It carries no history and no hedge.

```ts
// Good: packages/decide/src/modal-risk.ts:9, 21. A value, a union of exactly what can happen, a spec named for the question.
export type ModalRisk = "opens-dialog" | "analyzes-in-background" | "may-ask-options" | "no-dialog";
export const MODAL_RISK: ChoiceSpec<EffectUse, ModalRisk> = choice<EffectUse, ModalRisk>({ name: "modal-risk", /* ... */ });
```

```ts
// Bad: says nothing, and will say something different next month.
const data = await handler(info);
const newResult2 = processStuff(data, true);
```

Functions are verbs (`withoutApplyInstructions`, `fittedBands`), predicates are questions, quantities carry units
(`timeoutMs`). If you reach for `new`, `legacy`, `old`, `v2`, `compat` or `temp`, the design is not settled yet.

## Small functions, no comments inside them

A function is short enough that its name and its callees explain it. If a line needs a comment, the line wants a name:
extract a function and let the name be the comment. Only exports carry a doc comment, and it states the guarantee, not
the mechanism.

```ts
// Good: packages/decide/src/route.ts:42-44, 46-49. Two tiny named steps; the second reads like the sentence it implements.
function yesNoMargin(probability: number): number {
  return Math.abs(2 * probability - 1);
}

function labelMargin(model: ReadonlySet<string>, deterministic: ReadonlySet<string>, probabilities: Readonly<Record<string, number>>): number {
  const differing = Object.entries(probabilities).filter(([label]) => model.has(label) !== deterministic.has(label));
  return Math.min(...differing.map(([, probability]) => yesNoMargin(probability)));
}
```

```ts
// Bad: the comments are doing the naming.
function margin(m, d, p) {
  // find the labels where the model and the deterministic answer differ
  const x = Object.entries(p).filter(([l]) => m.has(l) !== d.has(l));
  // distance of each probability from a coin flip, smallest wins
  return Math.min(...x.map(([, q]) => Math.abs(2 * q - 1)));
}
```

Guard clauses first, the main path last and flat (`agent-failure.ts:57-61`). When the cases are data, write a table,
not a ladder.

## Data shapes over flags

Make the illegal state impossible to write. A discriminated union beats an object of optional fields; a literal union
beats a boolean that means three things; a table beats a `switch`.

```ts
// Good: packages/decide/src/route.ts:22-25. Either the model's answer is taken, or the decision falls through, and
// the failure is present exactly when it fell.
export type Routed =
  | { readonly ok: true; readonly core: AnyCore; readonly band: Band }
  | { readonly ok: false; readonly failure: Failure; readonly band: Band };
```

```ts
// Good: packages/decide/src/fitted-bands.ts:4-8. A decision's thresholds are one row of data, not an if per decision.
const FITTED_BANDS: Readonly<Record<string, Bands>> = {
  "request-parts": { verify: 0, act: 0.7 },
  "evidence-judgement": { verify: 0.8, act: 0.8 },
};
```

```ts
// Bad: three flags, eight states, three of them meaningless.
function route(answer: Answer, taken?: boolean, failed?: boolean, retry?: boolean) { /* ... */ }
```

A boolean parameter that switches behaviour is two functions. `undefined` means not given, `null` means known to be
absent, and one module never uses both for the same thing.

## Deterministic by default, with decision ports for the fuzzy parts

Most of what looks like language understanding is a small closed question: which effect did the request name, is this a
drawn scene, is the job complete. We declare each one once, as a typed spec with a deterministic answer that is always
there, offline and testable. A better answerer may take over, by confidence band, and never has to be present.

The order is fixed: **deterministic, then the user's own model, then a decision model (Jev)**. A decision model answers
first because it is fast and cheap, but its answer is used only when its confidence clears the decision's band:

- **act**: the answer is taken;
- **verify**: it is taken only when it agrees with the deterministic answer or leads it by a margin;
- **escalate**: it is dropped and the next tier answers.

```ts
// Good: packages/decide/src/modal-risk.ts:15-19, 22-35. The deterministic function is the product; the labels are what a
// model is asked. With no key configured, riskOf answers and nothing leaves the machine.
function riskOf(effect: EffectUse): ModalRisk {
  if (DIALOG_EFFECTS.has(effect.matchName)) return "opens-dialog";
  if (ANALYSIS_EFFECTS.has(effect.matchName)) return "analyzes-in-background";
  return effect.hasOptionsDialog === true ? "may-ask-options" : "no-dialog";
}
```

```ts
// Bad: the fuzzy rule is buried where it cannot be tested or improved, and a model can never help.
if (/glow|bloom|shine/.test(request) && !/not/.test(request)) addGlow();
```

Costly mistakes are `guarded` so a model answer for them is taken only in the act band. Thresholds belong to the
provider and are fitted on evaluation data, not guessed (`fitted-bands.ts`). See
[`packages/decide`](../packages/decide/README.md).

## One way to do each thing

Two ways to do something is one way too many: they drift, and the reader has to learn both. When a better way arrives,
migrate every caller and delete the old one in the same change. There are no compatibility shims, no deprecated
aliases, no "old path still works" branches, and no code that migrates data from builds that were never released.
Deleting is the refactor.

```ts
// Good: one entry point, one meaning.
export function fittedBands(name: string): Bands | undefined {
  return FITTED_BANDS[name];
}
```

```ts
// Bad: the second export exists only so nobody has to update a caller.
export function getBands(name: string) { return fittedBands(name) ?? defaultBands(); }
/** @deprecated use fittedBands */
export const bandsFor = fittedBands;
```

A rule, a limit or a name lives in exactly one module (`packages/decide/src/route.ts:7-10` holds the two routing
constants; nothing else repeats them). A dead export is a gate failure for the same reason.

## Tests state behaviour

A test name is a sentence about what the program does, and one test checks one behaviour. Read the names alone and you
should be able to rebuild the specification.

```ts
// Good: packages/decide/tests/route.test.ts:24, 29, 34.
test("a confident answer is taken in the act band even against the deterministic answer", async () => { /* ... */ });
test("an unsure answer is dropped in the escalate band", async () => { /* ... */ });
test("in the verify band agreement takes the model's answer", async () => { /* ... */ });
```

```ts
// Bad: names a function, not a behaviour; asserts the implementation.
test("route works", () => { assert.ok(route(input)); });
test("calls yesNoMargin twice", () => { /* spies on a private helper */ });
```

Tests use small helpers that say what they build (`modelAnswering("beta", 0.95, 0.02)`,
`route.test.ts:19-22`), synthetic fixtures, injected clocks and fetches, and no After Effects. Live tests that need an
outside service run only under `pnpm test:live`, never in the gate; without a key they skip with a stated reason.

## The test of taste

Read your diff as a stranger. If a name makes you pause, rename it. If a function makes you scroll, split it. If you
need a comment, you have found a missing name. If something is only there so that something else keeps working, delete
both and rebuild the one way.
