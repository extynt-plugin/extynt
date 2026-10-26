/** Panel contract: images attached to a message: the + button, paste and drop, limits, removal, and what the saved transcript keeps. */
import assert from "node:assert/strict";
import test from "node:test";
import { answered, chatBodies, element, noticeTexts, nth, rowsOf } from "./contract-helpers.js";
import { createPanelHarness, PNG } from "./contract.test.js";
import { arrayOf, fieldOf, recordsAt } from "./json-narrow.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";


const pngFile = (name: string, extra: JsonObject = {}) => ({ name, type: "image/png", size: 1000, dataUrl: PNG, ...extra });
const refStrip = (harness: ReturnType<typeof createPanelHarness>) => element(harness, "references");
const attachFiles = (harness: ReturnType<typeof createPanelHarness>, files: JsonValue[]) => {
  const input = element(harness, "attach-input");
  Object.assign(input, { files });
  input.dispatch("change");
};

test("the + button opens the picker, thumbnails show above the input, and the message carries the images", () => {
  const harness = createPanelHarness({ respond: answered("ok") });
  assert.equal(
    element(harness, "attach-input").getAttribute("aria-label"),
    "Attach images",
    "the input is the one control keyboard users reach",
  );
  assert.equal(element(harness, "attach-images").getAttribute("aria-hidden"), "true");
  attachFiles(harness, [pngFile("look.png"), pngFile("mood.png")]);
  assert.equal(refStrip(harness).hidden, false);
  assert.equal(refStrip(harness).all((node) => node.tagName === "IMG").length, 2);
  harness.send("make it look like this");
  const images = recordsAt(nth(chatBodies(harness), 0), "images");
  assert.deepEqual(
    images.map((image) => [fieldOf(image, "mediaType"), fieldOf(image, "name")]),
    [
      ["image/png", "look.png"],
      ["image/png", "mood.png"],
    ],
  );
  assert.equal(fieldOf(nth(images, 0), "base64"), PNG.slice(PNG.indexOf(",") + 1));
  assert.equal(refStrip(harness).hidden, true, "the strip is spent once sent");
  assert.equal(nth(rowsOf(harness, "user"), 0).all((node) => node.classList.has("ref-image")).length, 2, "the bubble shows the thumbnails");
});

test("pasting or dropping images on the composer attaches them; other pastes are left alone", () => {
  const harness = createPanelHarness({ respond: answered("ok") });
  element(harness, "chat-message").dispatch("paste", { clipboardData: { files: [pngFile("pasted.png")] } });
  element(harness, "composer").dispatch("drop", { dataTransfer: { types: ["Files"], files: [pngFile("dropped.png")] } });
  assert.equal(refStrip(harness).all((node) => node.tagName === "IMG").length, 2);
  let prevented = false;
  element(harness, "chat-message").dispatch("paste", {
    clipboardData: { files: [] },
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
});

test("drags that do not carry files are left alone, on the composer and everywhere else", () => {
  const harness = createPanelHarness({ respond: answered("ok") });
  let prevented = 0;
  const note = {
    preventDefault: () => {
      prevented += 1;
    },
  };
  element(harness, "composer").dispatch("dragover", { ...note, dataTransfer: { types: ["text/plain"] } });
  element(harness, "composer").dispatch("drop", { ...note, dataTransfer: { types: ["text/plain"], files: [pngFile("x.png")] } });
  assert.equal(prevented, 0);
  assert.equal(refStrip(harness).hidden, true);
  element(harness, "composer").dispatch("dragover", { ...note, dataTransfer: { types: ["Files"] } });
  assert.equal(prevented, 1);
});

test("the + button never clicks the file input by script (AE's WKWebView ignores it; the input covers the button)", () => {
  const harness = createPanelHarness({ respond: answered("ok") });
  let inputClicks = 0;
  element(harness, "attach-input").addEventListener("click", () => {
    inputClicks += 1;
  });
  harness.click("attach-images");
  assert.equal(inputClicks, 0);
});

test("Remove drops one thumbnail and the next message goes without it", () => {
  const harness = createPanelHarness({ respond: answered("ok") });
  attachFiles(harness, [pngFile("a.png"), pngFile("b.png")]);
  nth(
    refStrip(harness).all((node) => node.classList.has("ref-remove")),
    0,
  ).click();
  assert.equal(refStrip(harness).all((node) => node.tagName === "IMG").length, 1);
  attachFiles(harness, []);
  harness.send("go");
  assert.equal(arrayOf(fieldOf(nth(chatBodies(harness), 0), "images")).length, 1);
});

test("a seventh image, a 6 MB image and a GIF are refused with the reason, and the rest are kept", () => {
  const harness = createPanelHarness({ respond: answered("ok") });
  attachFiles(
    harness,
    [1, 2, 3, 4, 5, 6, 7].map((n) => pngFile(n + ".png")),
  );
  assert.equal(refStrip(harness).all((node) => node.tagName === "IMG").length, 6);
  assert.ok(noticeTexts(harness).includes("Up to 6 images can be attached to one message; 1 not added."));
  const other = createPanelHarness({ respond: answered("ok") });
  attachFiles(other, [pngFile("big.png", { size: 6 * 1048576 }), pngFile("anim.gif", { type: "image/gif" }), pngFile("ok.png")]);
  assert.ok(noticeTexts(other).includes("“big.png” was not attached: it is 6.0 MB and images can be at most 5 MB each."));
  assert.ok(noticeTexts(other).includes("“anim.gif” was not attached: only PNG, JPEG and WebP images can be."));
  assert.equal(refStrip(other).all((node) => node.tagName === "IMG").length, 1);
});

test("no image bytes reach the saved transcript", () => {
  const harness = createPanelHarness({ respond: answered("ok") });
  attachFiles(harness, [pngFile("a.png")]);
  harness.send("hi");
  assert.ok(
    !JSON.stringify(harness.requests.filter((record) => record.url.includes("/v1/ui/")).map((record) => record.body)).includes(
      PNG.slice(PNG.indexOf(",") + 1),
    ),
  );
});
