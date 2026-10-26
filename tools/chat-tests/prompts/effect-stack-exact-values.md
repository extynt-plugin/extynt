---
id: effect-stack-exact-values
asset: summer-launch
offline: false
notes: Effects with exact values on one layer. Tests that every named control lands at the number asked for, that a menu control is chosen by meaning (Blur Dimensions), and that a Gaussian request does not narrow the rest of the plan.
expect: {"plans":{"min":1},"targetsLayer":"layer-title","requiredOperationTypes":["ensure_effect","set_effect_control"],"requiredPropertyPaths":["ADBE Gaussian Blur 2","ADBE Glo2","ADBE Drop Shadow"],"execution":"success","requiredControlValues":{"ADBE Gaussian Blur 2-0001":8,"ADBE Gaussian Blur 2-0002":1,"ADBE Glo2-0003":40,"ADBE Glo2-0004":1.5,"ADBE Drop Shadow-0004":20,"ADBE Drop Shadow-0005":30}}
---

On the selected title, add a Gaussian Blur with Blurriness 8 that blurs in both directions, a new Glow (leave the existing one alone) with
Glow Radius 40 and Glow Intensity 1.5, and a Drop Shadow with Distance 20 and Softness 30.
