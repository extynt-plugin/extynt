---
id: effect-menus-by-meaning
asset: summer-launch
offline: false
notes: Harder effect controls on one layer. Popup menus chosen by their label where separators shift the numbering (Fractal Type, Blending Mode, Glow Operation), a negative value, and a Fill opacity whose range is 0 to 1 rather than percent. Every value is checked, so a menu item one off is a failure.
expect: {"plans":{"min":1},"targetsLayer":"layer-title","requiredOperationTypes":["ensure_effect","set_effect_control"],"requiredPropertyPaths":["ADBE Fractal Noise","ADBE Glo2","ADBE Fill"],"requiredControlValues":{"ADBE Fractal Noise-0001":3,"ADBE Fractal Noise-0004":150,"ADBE Fractal Noise-0005":-10,"ADBE Fractal Noise-0015":4,"ADBE Fractal Noise-0030":7,"ADBE Glo2-0003":25,"ADBE Glo2-0006":6,"ADBE Fill-0005":0.5},"execution":"success"}
---

On the selected title, add Fractal Noise set to Turbulent Smooth with Contrast 150, Brightness -10 and
Complexity 4, with the Fractal Noise effect's own Blending Mode control set to Overlay. Then add a second
Glow (leave the existing one as it is) using the Screen glow operation with a Glow Radius of 25, and
finish with a Fill in warm orange (#FF8A00) at 50% opacity.
