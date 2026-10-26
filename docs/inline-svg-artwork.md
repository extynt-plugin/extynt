# Inline SVG artwork in After Effects

extynt accepts SVG markup directly through `ae_create_vector_artwork`.
Pass the SVG code itself as the `svg` text, never a file path: an agent holding
an .svg file on disk reads the file and passes its complete contents unchanged
(including any `<?xml?>` header and metadata that validate). The tool has no
path parameter because extynt writes the markup to its own managed file for
After Effects, whose importer only imports files.
The user does not create, name, or choose a source file. extynt validates the
markup while building the normal reviewable plan, and only after that plan is
accepted does the local After Effects host write the SVG to extynt's managed
app-data directory and ask After Effects to import it as a composition (natively on 26+, through extynt's converter on 25)
of native shape layers.

`editable` is the supported import mode. The result is a real project
composition whose shape paths can be edited in After Effects. The tool may
also place that composition as one layer in an existing composition by passing
`targetCompositionId`. It can import into an existing project folder with
`destinationFolderId`. Neither option accepts a filesystem path.

Linear and radial gradients, including multiple stops and their anchors, stay
in the SVG sent to After Effects's native importer; extynt does not replace
them with solid fills. After import, After Effects exposes the resulting shape
paths for point editing, but its scripting API still does not expose the
native gradient colour-stop value. An agent can create revised inline SVG as
new artwork, but must not claim it can rewrite an imported stop list in place.
Filters, text conversion, blend behavior, masks, clipping, animation, and
other SVG-to-AE fidelity remain properties of Adobe's importer and require a
live frame check; the receipt verifies structure and source identity, not
pixel-perfect appearance.

## Accepted subset and hard limits

The sanitizer preserves ordinary SVG elements, paths, groups, nested
transforms, presentation attributes, local fragment references used by paint
servers, gradients, masks, clip paths, and text. It applies these limits before a plan can be
accepted:

| Limit | Value |
| --- | ---: |
| UTF-8 source | 262,144 bytes |
| Element nesting | 32 levels |
| Elements | 2,048 |
| Attributes on one element | 64 |
| One attribute value | 32,768 UTF-8 bytes |
| Path commands | 50,000 |
| Gradient stops | 256 |

It refuses DTDs and entities, processing instructions other than the XML
declaration, scripts, event handlers, `foreignObject`, embedded HTML/media,
`image`, `style` elements or attributes, external CSS/fonts/images, and any
network, file, data, or otherwise non-local URL. `href`, `xlink:href`, and
`url(...)` may point only at an id inside the same SVG. `xml:base` and `<use>`
are refused: a model should expand reusable symbols into bounded ordinary
geometry so local references cannot trigger recursive or exponential import.
Malformed markup,
duplicate attributes, non-finite values, and numeric magnitudes above
1,000,000,000 are also refused. This deliberately secure subset is not a
claim that every feature in the SVG standard maps to an After Effects shape.

`linked` mode returns `VECTOR_MODE_UNSUPPORTED`. extynt does not present a
linked-file workflow until it can guarantee the file lifecycle honestly.

## Native import first, extynt's converter as the guaranteed fallback

After Effects' own SVG importer is always tried first, because it handles more
of SVG than extynt does: the host runs it with dialogs suppressed and, when it
imports a composition with at least one shape layer, that is the result
(`importer: "native"`). Some After Effects releases import the composition but return
`null` from `importFile`: the host compares the project's items before and
after, adopts the one new composition as the result, and, when the import added
anything else (or nothing), removes whatever it added and treats the import as
refused (`SVG_IMPORT_FAILED`, with the count in the evidence), so a failed
import never leaves items behind.

If the importer refuses (`SVG_IMPORT_UNSUPPORTED`, `SVG_IMPORT_FAILED`) or
returns a composition without shape layers, the host builds the composition
itself from shapes the sidecar converted from the same SVG (`importer:
"converted"`): a composition of the SVG's size with the native path's timing,
one shape layer per top-level element or group, named from its `id` or by
element and position. The receipt step carries the refusal code and the
importer's evidence, the line "Imported with extynt's converter (AE's SVG
importer refused: <code>)", and the features the converter approximated or left
out. Verification checks the converted result's shape layers, comp size, name,
folder and timing.

The converted layers, comp size and notes ride on the `create_vector_artwork`
operation as `fallbackLayers`, `fallbackSize` and `fallbackNotes`. They are
derived data: plan validation recomputes them from the operation's own `svg`
and refuses a plan whose fallback differs. When the converter cannot take the
SVG (more than 256 shapes or 12,000 points in total, more than 64 subpaths in
one element or 1,000 points in one subpath, no usable size) the operation
carries `fallbackUnavailable` with the reason instead, the approval card says
"no extynt converter fallback", and a native refusal remains a failure. Nothing
is dropped silently.

After Effects only has an SVG importer from 26.0. When the connected host is older
(its version is read from the host key), the sidecar adds `importer: "converter"`
and `importerAeVersion` to the operation, and the host skips the native importer
entirely: the receipt note reads "Built with extynt's converter (After Effects
<version> has no SVG importer)", and an SVG past the converter's limits fails with
`SVG_IMPORT_UNSUPPORTED` and the reason. The approval card says the same and lists
what the converter changes (gradients become solid colours, text is skipped, clip
paths, masks and filters are skipped). An unknown version keeps native first.
`EXTYNT_SVG_FORCE_CONVERTER=1` sends the same route on any version so the older-host
path can be tested on 26; only a development build honours it (the release package
sets `NODE_ENV=production`), and the sidecar logs one line at start saying so.

The converter handles `path` (M L H V C S Q T A Z, absolute and relative;
quadratics and arcs become cubics), `rect` (with `rx`/`ry`), `circle`,
`ellipse`, `line`, `polyline`, `polygon`, nested `g`, the `transform` attribute
(matrix, translate, scale, rotate, skewX, skewY) and the `viewBox`,
`width`/`height` and `preserveAspectRatio` mapping to the comp. Paint:
`fill`, `stroke`, `stroke-width`, `opacity`, `fill-opacity`, `stroke-opacity`,
`fill-rule`, line caps, joins and miter limit; colours as hex, `rgb()`/`rgba()`
or basic names. A gradient becomes its first stop's colour and is noted as
approximated. Text, clip paths, masks, filters, dashes and pattern fills are
not converted and are listed in the receipt as skipped. The managed SVG always
carries `xmlns="http://www.w3.org/2000/svg"`; the source hash is of that text.

## Managed-file and undo behavior

The host writes UTF-8 using a temporary file and same-directory rename beneath
the per-user `extynt/Managed SVG` directory. Names are derived from the source
SHA-256 plus the plan id; existing content is reused only when it matches.
The plan and receipt include the source hash, byte/element/path/gradient
inventory, imported project-item id, native shape-layer count, and retained
source-file notice.

After Effects Undo removes the project mutations, including the imported item
and any placed layer. It cannot remove a disk file, so the managed SVG remains
after Undo. extynt retains that file because After Effects may retain a
source relationship. The receipt says this explicitly.
