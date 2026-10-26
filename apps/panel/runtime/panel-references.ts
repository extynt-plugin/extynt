/**
 * Reference images for the next message ("make it look like this"): picked, pasted or dropped, shown as removable thumbnails,
 * and sent with the message.
 */
import { byId, clearChildren, el, inputById } from "./panel-dom.js";
import { hooks } from "./panel-hooks.js";
import { onLanguageChange, t } from "./panel-language.js";

interface ReferenceImage {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly dataUrl: string;
}

type ReferencePayload = {
  readonly mediaType: string;
  readonly base64: string;
  readonly name: string;
};

interface ReferenceSource {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly read: (done: (dataUrl: string | null) => void) => void;
}

const TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGES = 6;
const MAX_BYTES = 5 * 1024 * 1024;
const BYTES_PER_MB = 1048576;
const sent = new Map<string, string>();
let pending: ReadonlyArray<ReferenceImage> = [];
let reading = 0;
let counter = 0;

/** The images waiting for the next message. */
export function getReferenceImages(): ReadonlyArray<ReferenceImage> {
  return pending;
}

/** Replaces the waiting images and redraws the strip. */
export function setReferenceImages(list: ReadonlyArray<ReferenceImage>): void {
  pending = list;
  renderReferences();
}

/** The data URL of an image already sent in this panel, by id. */
export function referenceImageFor(id: string): string | null {
  return sent.get(id) ?? null;
}

/** Moves the pending images into the sent message's record and clears the strip; returns their ids for the transcript row. */
export function takeReferenceImages(): string[] {
  const ids = pending.map((image) => {
    sent.set(image.id, image.dataUrl);
    return image.id;
  });
  pending = [];
  renderReferences();
  return ids;
}

/** The waiting images as the sidecar takes them. */
export function referencePayload(): ReferencePayload[] {
  return pending.map((image) => ({ mediaType: image.mediaType, base64: image.dataUrl.slice(image.dataUrl.indexOf(",") + 1), name: image.name }));
}

function thumbNode(image: ReferenceImage): HTMLElement {
  const cell = el("span", "ref-thumb");
  const picture = el("img");
  picture.src = image.dataUrl;
  picture.alt = image.name;
  const drop = el("button", "ref-remove", "×");
  drop.type = "button";
  drop.title = t("chrome.refs.remove", { name: image.name });
  drop.setAttribute("aria-label", t("chrome.refs.remove", { name: image.name }));
  drop.addEventListener("click", () => {
    pending = pending.filter((entry) => entry !== image);
    renderReferences();
  });
  cell.appendChild(picture);
  cell.appendChild(drop);
  return cell;
}

function renderReferences(): void {
  const box = byId("references");
  if (!box) return;
  clearChildren(box);
  box.hidden = pending.length === 0;
  pending.forEach((image) => box.appendChild(thumbNode(image)));
}

function refuse(text: string): void {
  hooks.notice(text, "warn", null, true);
}

function fileSource(file: File): ReferenceSource {
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    read: (done) => {
      const reader = new FileReader();
      reader.onload = () => done(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => done(null);
      reader.readAsDataURL(file);
    },
  };
}

function problemWith(file: ReferenceSource): string {
  if (!TYPES.has(file.type)) return t("chrome.refs.wrongType", { name: file.name });
  if (file.size > MAX_BYTES) return t("chrome.refs.tooLarge", { name: file.name, megabytes: (file.size / BYTES_PER_MB).toFixed(1) });
  return "";
}

function readSource(file: ReferenceSource): void {
  reading += 1;
  file.read((dataUrl) => {
    reading -= 1;
    if (!dataUrl) {
      refuse(t("chrome.refs.unreadable", { name: file.name }));
      return;
    }
    counter += 1;
    pending = [...pending, { id: "ref-" + Date.now().toString(36) + "-" + counter, name: file.name || "image", mediaType: file.type, dataUrl }];
    renderReferences();
  });
}

function addSources(wanted: ReadonlyArray<ReferenceSource>): void {
  const room = MAX_IMAGES - pending.length - reading;
  const taken: ReferenceSource[] = [];
  let over = 0;
  wanted.forEach((file) => {
    const problem = problemWith(file);
    if (problem) refuse(problem);
    else if (taken.length >= room) over += 1;
    else taken.push(file);
  });
  if (over) refuse(t("chrome.refs.tooMany", { max: MAX_IMAGES, count: over }));
  taken.forEach(readSource);
}

function addReferenceFiles(files: ArrayLike<File>): void {
  addSources(Array.from(files, fileSource));
}

function imageFiles(list: FileList | null | undefined): File[] {
  return list ? Array.from(list).filter((file) => file.type.startsWith("image/")) : [];
}

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function wirePaste(message: HTMLElement): void {
  message.addEventListener("paste", (event: ClipboardEvent) => {
    const files = imageFiles(event.clipboardData?.files);
    if (!files.length) return;
    event.preventDefault();
    addReferenceFiles(files);
  });
}

function wireDrop(composer: HTMLElement): void {
  composer.addEventListener("dragover", (event: DragEvent) => {
    if (carriesFiles(event)) event.preventDefault();
  });
  composer.addEventListener("drop", (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    addReferenceFiles(imageFiles(event.dataTransfer?.files));
  });
}

/** The file input over the + button opens the picker (the click lands on the input, never a scripted click); pasting or dropping images on the composer adds them the same way. */
export function wireReferences(): void {
  onLanguageChange(renderReferences);
  const input = inputById("attach-input");
  input?.addEventListener("change", () => {
    addReferenceFiles(input.files ?? []);
    input.value = "";
  });
  const message = byId("chat-message");
  if (message) wirePaste(message);
  const composer = byId("composer");
  if (composer) wireDrop(composer);
}
