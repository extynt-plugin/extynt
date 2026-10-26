/** extynt's interface text: the six languages, the catalogue that holds every fixed sentence, the translator and the rule that picks the language. */
export { CATALOGUES, groupTables } from "./catalogue.js";
export type { LanguageTable, SourceCatalogue, UiKey } from "./catalogue.js";
export { placeholdersOf } from "./fill.js";
export { LANGUAGES, LANGUAGE_NAMES, isLanguage, isLanguageChoice, languageChoiceDecoder, languageDecoder, languageFromTag } from "./languages.js";
export type { Language, LanguageChoice } from "./languages.js";
export type { Entry, Message, PluralMessage, PluralTranslation } from "./message.js";
export { resolveLanguage } from "./resolve.js";
export type { LanguageSources } from "./resolve.js";
export { isUiKey, plainTextOf, translatorFor } from "./translate.js";
export type { Translate } from "./translate.js";
export { DECISION_PROVIDERS, DECISION_PROVIDER_FIELDS, providerAsksFor, providersAskingFor } from "./decision-providers.js";
export type { DecisionField, DecisionProvider } from "./decision-providers.js";
export { DECISION_FAILURE_CODES, decisionFailureText } from "./decision-failure.js";
export type { DecisionFailureCode } from "./decision-failure.js";
