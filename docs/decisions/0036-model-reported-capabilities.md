# ADR 0036: A model's capabilities are its own report

Status: accepted.

## Context

The sidecar decided what each model accepts from names: a table of Claude
families for effort, thinking, and output ceilings, and an `acceptsImages` flag
set per service (OpenAI and Anthropic yes, everything else no). Every new model
needed a code change, a model the table did not know was guessed at, and a
vision-capable model on another service (DeepSeek among them) could not capture
a frame. The OpenAI-compatible adapter also sent DeepSeek's `thinking` field to
every compatible service, which some of them refuse.

## Decision

1. `ModelCapabilities` (effort levels, image input, adaptive thinking, thinking
   display, the `thinking` field, output ceiling, window) is filled only by the
   provider: its metadata endpoint where it has one (Anthropic's Models API; a
   `/models` row that lists input modalities), and otherwise its refusal of a
   request. A field nobody reported stays absent.
2. Absent means "send it and let the provider answer". A `400` or `422` that
   names a field the step used is recorded, and the step is sent again without
   it, at most three times per step. A later step is built from what was
   learned.
3. An effort the model does not list becomes the nearest level it does list.
   `none` never becomes an explicit thinking disable on a model that thinks.
4. Images are offered unless the user's `AE_LLM_ACCEPTS_IMAGES` setting or the
   model says no. A model that said no receives a note that the frame was
   withheld, never the frame and never silence.
5. The settings view reports the model's levels and who answered the image
   question; the panel's effort menu offers only reported levels.

## Consequences

- No model names remain in the reasoning code. A new model works on the day it
  ships, as far as its provider reports it.
- A provider that publishes no metadata costs one refused request per thing
  learned, once per sidecar run: learned capabilities are kept across settings
  saves but not across restarts.
- A refusal is read by the field it names, which depends on the provider's
  wording; one that names nothing is reported as the step's failure, as before.

## Rejected alternatives

- Keeping the name table as a fallback: it is the guess this replaces.
- Probing every level with real requests: it spends generations to learn what a
  refusal teaches for free.
- Treating an unreported model as text-only: most current models take images,
  and the provider's refusal is a safe way to find the ones that do not.
