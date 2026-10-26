/** Entry of the gallery-icons bundle: exposes the icon table to the standalone design gallery, which has no module loader. */
import { ICONS } from "./icons.js";

Reflect.set(window, "EXTYNT_GALLERY_ICONS", ICONS);
