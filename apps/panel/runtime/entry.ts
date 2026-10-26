/** The panel's entry point: reads the session the native host injected, themes the page and starts the panel. */
import { startPanel } from "./panel-root.js";
import { applyTheme, readNativeInfo, watchTheme } from "./native.js";
import { dispatch } from "./ui-state.js";

const native = readNativeInfo(window);
dispatch({ type: "native", native });
applyTheme(document.documentElement, native ? native.theme : null);
watchTheme(window, (theme) => applyTheme(document.documentElement, theme));
startPanel(native !== null);
