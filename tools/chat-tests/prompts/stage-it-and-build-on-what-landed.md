---
id: stage-it-and-build-on-what-landed
asset: empty-ident
offline: false
notes: The loop test, and the only prompt that asks for it out loud. Every other prompt leaves the shape of the work to the agent, which is the right default but a slow way to find out whether incremental authoring actually happens; this one makes the staged shape the user's own request, so a run that ignores it has ignored the user rather than merely chosen differently. It asks for the container first and the rest after, which is exactly the order rule 2 anchors and the order the briefing says buys information - the composition and its background landing first is what makes the second stage a decision about a real project instead of a guess. Watch three things in the transcript: whether the first queue holds the composition and background and is SEALED rather than held open, whether the agent reads what landed (ae_status) before writing the type, and whether the second stage reuses the ids the host actually assigned instead of the __new__ placeholders. A run that writes one plan covering both stages has failed this prompt even if every operation is valid, because the user asked to see the first stage before the second was written.
expect: {"plans":{"min":2}}
---

Build a 10-second title card in this empty comp, and build it in two stages so I can see
the first one before you write the second.

Stage one: the composition and the backdrop. Deep indigo, a subtle radial falloff, and a
single warm amber glow sitting low and slightly left of centre. Seal that and let me look
at it.

Stage two, once that is in: the type over it. A short title, centred, and a thin rule under
it that draws on from the left over the first second.

Tell me what the first stage actually applied before you start the second.
