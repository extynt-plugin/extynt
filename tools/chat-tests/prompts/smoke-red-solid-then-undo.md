---
id: smoke-red-solid-then-undo
asset: empty-ident
offline: false
notes: Two turns in one conversation. Turn 1 builds a comp with a red solid; turn 2 asks to undo the last change and the comp and solid must be gone. The second message is carried with the first turn as history, the way the panel sends it.
expect: {"plans":{"min":1},"requiredOperationTypes":["create_composition","create_layer"]}
facts: [["comp-with-solid:Smoke"],["no-composition:Smoke"]]
---
make a 1920x1080 10 s comp named Smoke with a red solid
--- next turn ---
undo the last change
