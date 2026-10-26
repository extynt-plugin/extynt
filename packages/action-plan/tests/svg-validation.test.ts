// Covers inline svg validation: unsafe markup, limits, metadata and canonical text.
import test from "node:test";
import assert from "node:assert/strict";
import { INLINE_SVG_LIMITS, validateInlineSvgText } from "../src/index.js";

const gradientSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0ff"/><stop offset="1" stop-color="#fa0"/></linearGradient></defs><g transform="translate(10 10)"><path d="M0 0 C20 0 60 80 80 80 Z" fill="url(#g)"/></g></svg>';

test("inline SVG validation preserves gradients, paths, and nested transforms with deterministic metadata", () => {
  const result = validateInlineSvgText(gradientSvg);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.svg, gradientSvg);
  assert.equal(result.metadata.gradients, 1);
  assert.equal(result.metadata.gradientStops, 2);
  assert.equal(result.metadata.pathCommands, 3);
  assert.ok(result.metadata.maxDepth >= 3);
  assert.match(result.metadata.sourceHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(validateInlineSvgText(gradientSvg), result);
});

test("inline SVG validation allows text and same-document references without resolving resources", () => {
  const result = validateInlineSvgText('<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="curve" d="M0 10 L100 10"/></defs><text><textPath href="#curve">Safe local text</textPath></text></svg>');
  assert.equal(result.ok, true);
});

test("inline SVG validation rejects active content, entities, and external resources", () => {
  const unsafe = [
    '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>',
    '<svg><script>alert(1)</script></svg>',
    '<svg><path onclick="alert(1)" d="M0 0"/></svg>',
    '<svg xmlns:x="urn:test"><x:script>alert(1)</x:script></svg>',
    '<svg xmlns:x="urn:test"><path x:onload="alert(1)" d="M0 0"/></svg>',
    '<svg><foreignObject><div>html</div></foreignObject></svg>',
    '<svg><image href="https://example.com/a.png"/></svg>',
    '<svg><use href="file:///tmp/a.svg#x"/></svg>',
    '<svg xml:base="https://example.com/"><path fill="url(#paint)"/></svg>',
    '<svg><defs><path id="part" d="M0 0L1 1"/></defs><use href="#part"/></svg>',
    '<svg><style>@font-face{src:url(https://example.com/font.woff)}</style></svg>',
    '<svg><path d="MNaN 0"/></svg>',
    '<svg><text>A&amp;B</text></svg>',
    '<svg data-label="A&amp;B"/>',
    '<svg/><svg/>',
    '<svg><![CDATA[text]]></svg>',
    '<svg><path d="M0 0" d="M1 1"/></svg>',
  ];
  for (const svg of unsafe) { const result = validateInlineSvgText(svg); assert.equal(result.ok, false, svg); if (!result.ok) assert.match(result.code, /^SVG_(?:UNSAFE|INVALID)$/u); }
});

test("inline SVG validation reads a hex colour as a colour, not as an exponent, and still rejects an out-of-range coordinate", () => {
  for (const colour of ["#4e7124", "#2e4053", "#6E18D4"]) assert.equal(validateInlineSvgText(`<svg viewBox="0 0 10 10"><path d="M1 1 l5 5 z" fill="${colour}" stroke="${colour}"/></svg>`).ok, true, colour);
  const huge = validateInlineSvgText('<svg viewBox="0 0 10 10"><path d="M1e999 0 l5 5 z" fill="#4e7124"/></svg>');
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.equal(huge.code, "SVG_INVALID");
});

test("inline SVG validation enforces byte, depth, element, path, and stop limits", () => {
  const cases = [
    `<svg><!--${"x".repeat(INLINE_SVG_LIMITS.maxBytes)}--></svg>`,
    `<svg>${"<g>".repeat(INLINE_SVG_LIMITS.maxDepth + 1)}${"</g>".repeat(INLINE_SVG_LIMITS.maxDepth + 1)}</svg>`,
    `<svg>${"<path/>".repeat(INLINE_SVG_LIMITS.maxElements + 1)}</svg>`,
    `<svg><path d="${"M0 0 ".repeat(INLINE_SVG_LIMITS.maxPathCommands + 1)}"/></svg>`,
    `<svg><linearGradient>${"<stop/>".repeat(INLINE_SVG_LIMITS.maxGradientStops + 1)}</linearGradient></svg>`,
    `<svg ${Array.from({ length: INLINE_SVG_LIMITS.maxAttributesPerElement + 1 }, (_, index) => `data-${index}="x"`).join(" ")}/>`,
    `<svg data-long="${"x".repeat(INLINE_SVG_LIMITS.maxAttributeBytes + 1)}"/>`,
  ];
  for (const svg of cases) { const result = validateInlineSvgText(svg); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "SVG_LIMIT_EXCEEDED"); }
});

test("the managed SVG always carries the SVG namespace, and the hash is of the normalised text", () => {
  const bare = validateInlineSvgText('<svg viewBox="0 0 10 10"><path d="M0 0L1 1"/></svg>');
  assert.equal(bare.ok, true);
  if (!bare.ok) return;
  assert.equal(bare.svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L1 1"/></svg>');
  assert.equal(bare.metadata.bytes, Buffer.byteLength(bare.svg));
  const declared = validateInlineSvgText('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L1 1"/></svg>');
  assert.equal(declared.ok && declared.metadata.sourceHash, bare.metadata.sourceHash);
  const again = validateInlineSvgText(bare.svg);
  assert.equal(again.ok && again.svg, bare.svg, "normalising is idempotent");
});

test("namespace normalisation keeps an XML header, comments, a self-closing root and other namespaces", () => {
  const header = validateInlineSvgText('<?xml version="1.0"?>\n<!-- c -->\n<svg width="4" height="4"><path d="M0 0L1 1"/></svg>');
  assert.equal(header.ok && header.svg, '<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><path d="M0 0L1 1"/></svg>');
  const empty = validateInlineSvgText("<svg/>");
  assert.equal(empty.ok && empty.svg, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const linked = validateInlineSvgText('<svg xmlns:xlink="http://www.w3.org/1999/xlink"><path d="M0 0L1 1"/></svg>');
  assert.equal(linked.ok && linked.svg.includes('xmlns="http://www.w3.org/2000/svg" xmlns:xlink'), true);
  const upper = validateInlineSvgText('<SVG><path d="M0 0L1 1"/></SVG>');
  assert.equal(upper.ok && upper.svg.startsWith('<SVG xmlns="http://www.w3.org/2000/svg">'), true);
});

test("a source that only fits the limit before the namespace is added is refused", () => {
  const filler = "x".repeat(INLINE_SVG_LIMITS.maxBytes - 40);
  const result = validateInlineSvgText(`<svg><!-- ${filler} --></svg>`);
  assert.equal(result.ok, false);
  assert.equal(result.ok || result.code, "SVG_LIMIT_EXCEEDED");
});
