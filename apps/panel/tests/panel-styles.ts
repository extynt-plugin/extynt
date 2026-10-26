/** Reads the panel's stylesheets from the working tree, so tests can assert on rules without caring which file holds them. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STYLES_ROOT = "apps/panel/styles";

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? cssFiles(join(directory, entry.name)) : entry.name.endsWith(".css") ? [join(directory, entry.name)] : [],
    )
    .sort();
}

export function panelStyleFiles(): string[] {
  return cssFiles(STYLES_ROOT);
}

/** Every stylesheet, comments removed, in one string. */
export function readPanelStyles(): string {
  return panelStyleFiles()
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The declaration blocks (whitespace collapsed) of every rule whose selector list names this selector exactly. */
export function declarationsFor(css: string, selector: string): string[] {
  const blocks: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((part) => part.trim());
    if (selectors.includes(selector)) blocks.push((match[2] ?? "").replace(/\s+/g, " ").trim());
  }
  return blocks;
}
