---
id: mask-matte-and-type-pass
asset: summer-launch
offline: false
notes: An adversarial fixture-backed prompt aimed at masks, matte ordering, host font discovery, and an explicitly unsupported gradient-colour request. It names only layers that exist in summer-launch and acknowledges that the Plate is locked. The reveal-mask removal is expected to be refused by the fake host until that operation is modelled; the refusal must stay visible rather than being approximated.
expect: {"plans":{"min":1}}
---

Give the existing lower third and Accent Bar a proper masked treatment. The selected layer is
the main title; do not assume selection means the lower third. Leave the locked Plate untouched.

Art direction: the Accent Bar should wipe on from the left behind a soft-edged reveal mask.
Add a second, tighter mask on the same layer for a highlight band that travels across it once,
then rests. After the reveal is complete, remove only the reveal mask and keep the band mask;
animate the surviving mask's expansion as it settles. If the host cannot safely address the
surviving mask after removal, stop and explain the blocker rather than guessing an ordinal.

Create a separate soft white shine layer and use the lower-third text as its alpha matte, so
the highlight reads only through the letters. Put the layers in the correct order rather than
assuming the matte is already adjacent.

Set the lower-third text in a real installed typeface with some weight, not an invented font.

Put a marker on each of the three beats (wipe, band travel, settle) with a short comment.

One thing I would like and you may not be able to do: give the bar a gradient fill with
colour stops I name. If that is out of reach, say so plainly rather than approximating it.

At the end, distinguish what the fixture actually verified from anything that still needs a
real After Effects check, including undo behavior.
