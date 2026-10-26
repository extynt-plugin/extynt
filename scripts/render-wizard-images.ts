#!/usr/bin/env node

/**
 * Renders packaging/windows/branding/wizard.html to the 24-bit BMPs Inno Setup reads (needs google-chrome on the PATH).
 * Each size is the 100%, 150% and 200% scale of the base image, so Setup can pick one for the display's DPI.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cropImage, decodePng, encodeBmp } from "./lib/png-to-bmp.ts";
import { ROOT } from "./lib/sources.ts";

interface Artwork {
  readonly kind: string;
  readonly prefix: string;
  readonly widthPx: number;
  readonly heightPx: number;
}

interface Shot {
  readonly artwork: Artwork;
  readonly dark: boolean;
  readonly scale: number;
}

const BRANDING = join(ROOT, "packaging", "windows", "branding");
const ARTWORK: ReadonlyArray<Artwork> = [
  { kind: "side", prefix: "wizard", widthPx: 164, heightPx: 314 },
  { kind: "small", prefix: "wizard-small", widthPx: 55, heightPx: 55 },
];
const SCALES: ReadonlyArray<number> = [1.0, 1.5, 2.0];

function pageUrl({ artwork, dark }: Shot): string {
  const theme = dark ? "&theme=dark" : "";
  return `${pathToFileURL(join(BRANDING, "wizard.html")).href}?kind=${artwork.kind}${theme}`;
}

function screenshot(shot: Shot, file: string): void {
  const { artwork, scale } = shot;
  execFileSync("google-chrome", [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", `--force-device-scale-factor=${scale}`,
    `--window-size=${artwork.widthPx + 40},${artwork.heightPx + 140}`, `--screenshot=${file}`, pageUrl(shot),
  ], { stdio: "pipe" });
}

function renderBmp(shot: Shot): { readonly name: string; readonly bmp: Buffer } {
  const directory = mkdtempSync(join(tmpdir(), "extynt-wizard-"));
  try {
    const file = join(directory, "shot.png");
    screenshot(shot, file);
    const size = { width: Math.ceil(shot.artwork.widthPx * shot.scale), height: Math.ceil(shot.artwork.heightPx * shot.scale) };
    const image = cropImage(decodePng(readFileSync(file)), size);
    return { name: `${shot.artwork.prefix}${shot.dark ? "-dark" : ""}-${image.width}.bmp`, bmp: encodeBmp(image) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const artwork of ARTWORK) {
  for (const dark of [false, true]) {
    for (const scale of SCALES) {
      const { name, bmp } = renderBmp({ artwork, dark, scale });
      writeFileSync(join(BRANDING, name), bmp);
      console.log(name);
    }
  }
}
