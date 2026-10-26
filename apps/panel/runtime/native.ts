/**
 * The page's contract with the native host. After Effects' WKWebView (macOS) or WebView2 (Windows) injects
 * window.__extyntNative through a user script that runs on the sidecar origin only, before the page's own scripts:
 * { pluginVersion, aeVersion, sidecarOrigin, token, platform: "macos" | "windows", theme: { background: "#rrggbb", luminance: 0..1 } }.
 * When After Effects' brightness changes the host dispatches an "extynt-theme" event on window whose detail is the theme.
 */
import type { Decoder } from "@extynt/decode";
import { decode, fallback, literal, map, number, object, refine, string } from "@extynt/decode";

interface NativeTheme { readonly background: string; readonly luminance: number }
type NativePlatform = "macos" | "windows";
const DEFAULT_PLATFORM: NativePlatform = "macos";
export interface NativeInfo {
  readonly pluginVersion: string;
  readonly aeVersion: string | null;
  readonly sidecarOrigin: string;
  readonly token: string;
  readonly platform: NativePlatform;
  readonly theme: NativeTheme | null;
}

const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/;
const TOKEN = /^[A-Za-z0-9_-]{1,256}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const VERSION_LIMITS = { nonEmpty: true, maxLength: 64 } as const;

const themeDecoder: Decoder<NativeTheme | null> = fallback(object({
  background: string({ pattern: COLOUR }),
  luminance: number({ min: 0, max: 1 }),
}), null);

const versionOrNull: Decoder<string | null> = fallback(string(VERSION_LIMITS), null);

function injectionDecoder(pageOrigin: string | undefined): Decoder<NativeInfo> {
  const sidecarOrigin = refine(string(), (origin): origin is string => LOOPBACK_ORIGIN.test(origin) && (pageOrigin === undefined || pageOrigin === origin), "loopback origin of this page");
  return map(
    object({
      sidecarOrigin,
      token: string({ pattern: TOKEN }),
      pluginVersion: versionOrNull,
      aeVersion: versionOrNull,
      platform: fallback(literal("macos", "windows"), DEFAULT_PLATFORM),
      theme: themeDecoder,
    }),
    (injected) => ({ ...injected, pluginVersion: injected.pluginVersion ?? "" }),
  );
}

/** What the host injected, validated; null when the page runs outside the native panel or the injection is not trustworthy. */
export function readNativeInfo(target: Window): NativeInfo | null {
  const pageOrigin = target.location ? target.location.origin : undefined;
  const outcome = decode(injectionDecoder(typeof pageOrigin === "string" ? pageOrigin : undefined), Reflect.get(target, "__extyntNative"));
  return outcome.ok ? outcome.value : null;
}

function themeName(theme: NativeTheme | null): "dark" | "light" | null {
  if (!theme) return null;
  return theme.luminance < 0.5 ? "dark" : "light";
}

interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** Sets data-theme on the root: dark below 0.5 luminance, light at or above it, and cleared without a theme so the stylesheet's own fallback applies. */
export function applyTheme(root: ThemeRoot, theme: NativeTheme | null): void {
  const name = themeName(theme);
  if (name) root.setAttribute("data-theme", name);
  else root.removeAttribute("data-theme");
}

/** Re-themes the page whenever the host reports a new background; a missing or malformed theme clears it, so the page follows prefers-color-scheme. */
export function watchTheme(target: Window, onTheme: (theme: NativeTheme | null) => void): void {
  if (typeof target.addEventListener !== "function") return;
  target.addEventListener("extynt-theme", (event) => {
    const outcome = decode(themeDecoder, "detail" in event ? Reflect.get(event, "detail") : null);
    onTheme(outcome.ok ? outcome.value : null);
  });
}

declare global { interface Window { __EXTYNT_PRODUCT_VERSION__?: string } }

/** The product version the panel bundle was built for, or an empty string outside a built bundle. */
export function productVersion(): string {
  const version = window.__EXTYNT_PRODUCT_VERSION__;
  return typeof version === "string" ? version : "";
}
