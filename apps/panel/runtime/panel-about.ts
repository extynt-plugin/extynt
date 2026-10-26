/** Settings > About: the version of every part, from what the sidecar reported at boot and over the event stream. */
import { productVersion } from "./native.js";
import { setText } from "./panel-dom.js";
import { t, onLanguageChange } from "./panel-language.js";
import { onViewShown } from "./panel-page.js";
import { subscribeUi, uiState } from "./ui-state.js";

function versionOf(value: string | null | undefined): string {
  return value ? value : t("chrome.about.unknown");
}

function paintVersions(): void {
  const state = uiState();
  const sidecar = versionOf(state.sidecarVersion);
  setText("about-product", versionOf(productVersion()));
  setText("about-panel", versionOf(state.uiBuild));
  setText("about-sidecar", state.reachable ? sidecar : t("chrome.about.notReachable", { version: sidecar }));
  setText("about-mcp", versionOf(state.mcpVersion));
  setText("about-plugin", versionOf(state.host ? state.host.pluginVersion : null));
  setText("about-ae", versionOf(state.host ? state.host.aeVersion : null));
}

/** Keeps the About rows current while the Settings view is open. */
export function wireAbout(): void {
  subscribeUi((topic) => {
    if (topic === "host" || topic === "reach") paintVersions();
  });
  onViewShown("settings", paintVersions);
  onLanguageChange(paintVersions);
  paintVersions();
}
