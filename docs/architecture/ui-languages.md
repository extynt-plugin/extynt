# UI languages

extynt's own interface speaks English, Spanish, German, French, Japanese and Simplified Chinese (`en`, `es`, `de`, `fr`, `ja`, `zh-Hans`). The text lives in one typed catalogue, `packages/ui-text`, with English as the source.

## Which language is used

The first of these that names a supported language wins:

1. The user's choice in the panel Language setting (Settings, "Language"). It lists "Automatic" and the six languages in their own names. A choice applies live, with no reload, and persists in the sidecar preferences (`UiPrefs.language`, `"auto"` or a code).
2. The installer's choice: the file `ui-language` in the sidecar's per-user state directory.
3. After Effects' own UI language (`app.isoLanguage`, read by the panel host script and sent to the sidecar with the census).
4. English.

`resolveLanguage({ choice, installerTag, hostTag })` in `packages/ui-text/src/resolve.ts` implements the order. Tags such as `fr-FR`, `pt_BR`, `zh-CN` and `zh_Hans` are reduced to a supported code; anything else falls through to the next step.

## Installer contract

- File: `ui-language`, in the per-user state directory the sidecar already uses (`profileDirectory()`).
- Content: the first line holds a language code (`de`, `ja`, `zh-Hans`) or a locale tag (`fr-FR`). At most 32 characters. Surrounding whitespace is ignored.
- The sidecar reads it once per run. The installer writes it at install time; a user's explicit choice in the panel always overrides it.
- A missing, empty or unsupported value is ignored and resolution continues with After Effects' language.

The sidecar sends the resolved `interfaceLanguage` in the bootstrap reply and in the preferences replies. The panel paints English until the bootstrap reply arrives, then switches to the resolved language.

## Catalogue conventions

- One folder per domain under `packages/ui-text/src/domains/<domain>/` with `en.ts`, `es.ts`, `de.ts`, `fr.ts`, `ja.ts`, `zh-hans.ts` and `index.ts`. Domains: chrome, settings, chat, plans, status, model, memory, sidecar-failure, sidecar-plan, native.
- Keys are flat: `"<domain>.<area>.<name>"`. The sidecar-plan domain uses `plan.`, sidecar-failure uses `failure.`.
- Placeholders are named: `"Showing {count} of {total}"`. Never concatenate pieces of a sentence; one key per sentence so languages can reorder words.
- Plurals are entries `{ one, other }` selected with `Intl.PluralRules` on the `count` placeholder. Japanese and Simplified Chinese give only `other`.
- Terminology follows After Effects' own localized terms (composition, layer, keyframe, effect, project, expression). "extynt" is always lowercase and never translated.

## Where text is translated

- Panel: `t(key, params)` from `apps/panel/runtime/panel-language.ts`. Static markup uses `data-i18n`, `data-i18n-title`, `data-i18n-placeholder` and `data-i18n-aria-label`; `panel-static-text.ts` paints them and sets `<html lang>`.
- Sidecar: `translatorOf(state)` from `apps/sidecar/src/ui-language.ts`. Deeper pure code receives a `Translate` parameter.
- Windows catalogue window: a C++ table in `native/extynt-core/catalogue-window` (`catalogue_text*.cpp`). The sidecar's catalogue-engine route carries a top-level `language` field and the window uses it.

## Live switching

Choosing a language dispatches a `language` event in the panel store. Static markup repaints at once. Views that paint once register with `onLanguageChange(render)` and repaint in the new language. Text already sent to the model, stored in a chat transcript or recorded in a receipt keeps the language it was created in.

## What stays English

Prompts and tool descriptions meant for the model, the MCP setup prompt, developer diagnostics, the gallery, the macOS catalogue window and the installer (translated separately) stay English.

## Gate rules

- `packages/ui-text/tests` checks that every key exists in all six languages with the same placeholders and valid plural forms.
- `literal-scan.test.ts` scans `apps/panel/runtime/*.ts`, the sidecar files listed in `packages/ui-text/scopes/sidecar-*.txt` and the panel markup, and fails on any user-facing English literal that is not a catalogue key. Genuine non-text (identifiers, class names, protocol values) is listed with a reason in `scopes/not-text-words-*.txt` and `scopes/not-text-literals-*.txt`; files exempt from the scan are in `scopes/panel-exempt-*.txt`. Full offender lists are written to `.check-logs/literal-scan-*.txt`.
