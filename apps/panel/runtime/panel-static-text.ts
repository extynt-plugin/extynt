/** Paints the text that lives in index.html: each element names its catalogue key in a data-i18n attribute and gets the words of the current language. */
import { isUiKey, plainTextOf } from "@extynt/ui-text";
import { currentLanguage, onLanguageChange } from "./panel-language.js";

const TEXT_ATTRIBUTE = "data-i18n";
const ATTRIBUTE_TARGETS: ReadonlyArray<readonly [string, string]> = [["data-i18n-title", "title"], ["data-i18n-placeholder", "placeholder"], ["data-i18n-aria-label", "aria-label"]];
const SELECTOR = [`[${TEXT_ATTRIBUTE}]`, ...ATTRIBUTE_TARGETS.map(([source]) => `[${source}]`)].join(",");

function wordsOf(key: string | null): string | null {
  return key !== null && isUiKey(key) ? plainTextOf(currentLanguage(), key) : null;
}

function paintElement(node: Element): void {
  const text = wordsOf(node.getAttribute(TEXT_ATTRIBUTE));
  if (text !== null) node.textContent = text;
  for (const [source, target] of ATTRIBUTE_TARGETS) {
    const words = wordsOf(node.getAttribute(source));
    if (words !== null) node.setAttribute(target, words);
  }
}

/** Fills every marked element of the page now and again after each language change. */
export function keepStaticTextPainted(): void {
  const paint = (): void => {
    document.documentElement.setAttribute("lang", currentLanguage());
    document.querySelectorAll(SELECTOR).forEach(paintElement);
  };
  paint();
  onLanguageChange(paint);
}
