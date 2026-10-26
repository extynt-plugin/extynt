---
id: three-shot-sequence-instanced
asset: empty-ident
offline: false
notes: The hardest prompt in this set. It forces verified created-ID bindings across bounded batches: the sequence composition must settle before either main-comp instance can target its assigned id, and both instances then need distinct timing. It also covers expression-driven drift, a matted shine, a masked reveal, host font discovery, per-shot markers, and an unsupported LUT request. Each fake receipt is architecture evidence only, never proof of real AE undo or read-back behavior.
expect: {"plans":{"min":1}}
---

Build a 10-second, three-shot title sequence in this empty comp.

The three shots:

1. **Assemble** (0–3s). The word SIGNAL comes together out of the dark, letter by letter,
   over a deep indigo field with a slow radial falloff.
2. **Collapse** (3–6.5s). The field tightens into a horizontal band across the middle, and
   a cyan sweep crosses it once, left to right.
3. **Push** (6.5–10s). The camera settles and pushes in slowly on the finished lockup.

Build all three shots inside their own composition called `SIGNAL — Sequence`, then place
that composition in the main comp **twice**: once as the sequence itself, and again at the
end as a roughly four-times-speed recap sting, hard against the tail. The two instances
must run at different speeds, so drive their timing rather than trimming them by hand.

Everything else:

- The band in shot 2 wants a soft edge, so give it a mask that wipes on from the left, and
  a shine that travels across it — the shine should be its own layer, matted by the SIGNAL
  wordmark, so the sweep reads through the letterforms rather than sliding across them.
- Do not hand-key the background drift across all ten seconds. There is a way to make it
  run forever from a short piece of motion; use it.
- One camera move for the whole piece, pushing in during shot 3.
- The wordmarks get a real typeface with weight — not the After Effects default.
- A marker at each shot boundary, with a short comment naming the shot.

One thing I would like and you may not be able to do: put a film LUT over the whole thing.
If that is out of reach, say so plainly rather than substituting something that looks
close.

At the end, summarize the applied batches and their recorded undo units, and call out anything
that still requires visual, temporal, or real After Effects verification.
