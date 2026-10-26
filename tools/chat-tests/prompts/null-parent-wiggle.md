---
id: null-parent-wiggle
asset: summer-launch
offline: false
notes: Parenting plus an expression across layers. Passes when a null is the title layer's parent and that null carries a wiggle expression.
expect: {"plans":{"min":1},"requiredOperationTypes":["set_layer_parent","set_expression"],"anyOperationMatches":["wiggle"]}
facts: [["parent-is-null:layer-title","parent-null-expression:layer-title:wiggle"]]
---
add a null and parent the title to it, then wiggle the null
