// The language of the sidecar's own text and of the panel: the user's choice in Settings, then the language the installer wrote to the state directory, then After Effects', then English.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLanguage, translatorFor, type Language, type Translate } from "@extynt/ui-text";
import { profileDirectory } from "./profile-store.js";
import type { SidecarState } from "./server-state.js";
import { uiStoreFor } from "./ui-store.js";

const INSTALLER_LANGUAGE_FILE = "ui-language";

const MAX_TAG_CHARS = 32;

type LanguageState = Pick<SidecarState, "hostFacts" | "now" | "options">;

const installerTags = new WeakMap<WeakKey, string | null>();

function readInstallerTag(directory: string): string | null {
  try {
    const line = readFileSync(join(directory, INSTALLER_LANGUAGE_FILE), "utf8").split(/\r?\n/)[0]?.trim() ?? "";
    return line === "" || line.length > MAX_TAG_CHARS ? null : line;
  } catch {
    return null;
  }
}

function installerTagOf(state: LanguageState): string | null {
  if (installerTags.has(state)) return installerTags.get(state) ?? null;
  const tag = readInstallerTag(state.options.stateDirectory ?? profileDirectory());
  installerTags.set(state, tag);
  return tag;
}

/** The language the interface speaks now; it follows a change of the user's choice at once and After Effects' language once the host has reported it. */
export function interfaceLanguageOf(state: LanguageState): Language {
  return resolveLanguage({ choice: uiStoreFor(state).prefs().language, installerTag: installerTagOf(state), hostTag: state.hostFacts.isoLanguage });
}

/** A translator for the interface language now, for text the sidecar composes for the panel. */
export function translatorOf(state: LanguageState): Translate {
  return translatorFor(interfaceLanguageOf(state));
}
