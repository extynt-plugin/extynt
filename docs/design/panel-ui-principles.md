# Panel UI principles

Twenty rules the extynt panel (`apps/panel/index.html` and `apps/panel/styles/`)
follows. They exist because the panel grew feature by feature and stopped
following any of them: four text buttons wrapping in the header, three status
indicators, nine font sizes, four corner radii, hardcoded colours, and the
accent blue meaning "live", "selected", "approve" and "a note" at once. Every
change to the panel's markup or CSS is checked against this list. The tokens below are the one place the look (palette, accent, density,
bubbles, receipts) is written down.

## Files

`index.html` is markup only: no `<style>`, no `style=` attribute, no inline
handler (the native host's CSP forbids them). All CSS lives in `styles/`:

- `tokens.css`: primitives and the semantic tokens of both themes.
- `base.css`: reset, typography, focus ring, scrollbars, the one set of button,
  field and icon rules, reduced motion.
- `layout.css`: frame, topbar, transcript, composer shell, sections.
- `components/*.css`: one file per component (`message`, `notice`, `status-bar`,
  `sheet`, `page`, `plan-card`, `receipt`, `variant`, `list-row`, `composer`, `menu`,
  `empty-state`, `setup-card`, `settings`, `diagnostics`, `badge-dot`, `context`).
- One scroller per surface (the thread, the sheet, the page body; the model popover past its max-height), `overflow: auto` only, no horizontal scrolling.
- `gallery.html` shows every component in both themes at 360, 260 and 480 px
  with the real stylesheets; open it for review, it is never shipped.

`apps/panel/tests/dom-contract.test.ts` keeps the runtime and these files in
step: every id the runtime queries exists in `index.html`, every class it emits
has a rule in `styles/`, and nothing inline creeps back. `tokens-contrast.test.ts`
proves the contrast numbers in rule 10.

## Themes

The panel has two themes, dark and light, and follows After Effects.

- Contract: the host sets `data-theme="dark"` or `data-theme="light"` on
  `<html>` (dark when AE's background luminance is below 0.5, light otherwise,
  updated live when AE's brightness changes). With no `data-theme` attribute the
  panel follows `prefers-color-scheme`; with neither it is dark.
- `color-scheme` follows the theme, so form controls and scrollbars match.
- Every colour is a fixed value. Nothing uses `color-mix()`, which WebKit on
  macOS 12 may lack. The light palette is declared twice (explicit and media
  fallback) and the contrast test fails if the copies drift.

## Tokens

All values are in `styles/tokens.css`; components reference semantic tokens
only.

| Token | Dark | Light |
| --- | --- | --- |
| `--bg` / `--surface` / `--raised` | `#16171b` / `#1d1f25` / `#262932` | `#f5f6f8` / `#ffffff` / `#eef0f3` |
| `--field` / `--hover` | `#121316` / `#2e323d` | `#ffffff` / `#e6e9ee` |
| `--line` / `--line-strong` | `#30343e` / `#3f4452` | `#dde0e6` / `#c3c8d2` |
| `--text` / `--muted` / `--faint` | `#e9eaef` / `#99a0ad` / `#8a91a0` | `#181a1f` / `#5d6370` / `#656c7a` |
| `--accent` (rings, edges, graphics) | `#7c6cf2` | `#7c6cf2` |
| `--accent-solid` / `-hover` / `-pressed` (fills under white text) | `#6a5ae8` / `#5e4ee0` / `#5243d2` | same |
| `--accent-text` / `--on-accent` | `#a99dff` / `#ffffff` | `#5240d4` / `#ffffff` |
| `--accent-soft` / `--accent-line` | `rgba(124,108,242,.16)` / `rgba(124,108,242,.45)` | `rgba(124,108,242,.12)` / `rgba(106,90,232,.4)` |
| `--user-bg` | `#2a2846` | `#e4e3f7` |
| `--green` / `--amber` / `--red` / `--red-text` | `#4cc38a` / `#e8b04b` / `#f2807f` / `#f59a99` | `#136a42` / `#855300` / `#c03434` / `#a82525` |
| soft tints (green, amber, red) | 14% of the hue | 10-12% of the hue |

Scales shared by both themes: spacing `--s1..--s6` (4, 8, 12, 16, 24) and
`--card-pad` 14px; radii `--r-sm` 4, `--r` 8, `--r-lg` 12 (the composer),
`--r-pill`; controls `--control` 30px (32px from the 340px container width) and
`--control-sm` 24px; type `--fs-meta` 11, `--fs-small` 12, `--fs` 13 (body and
controls), `--fs-title` 14, `--fs-display` 16 at weights 400 and 600; motion
`--t-fast` 120ms, `--t-base` 160ms. The font is the system UI font; paths,
expressions and code use `--mono`; numbers in costs, counts and times use
`font-variant-numeric: tabular-nums`.

## Widths

360px is the reference layout; 260px is the supported minimum, where things
stack. The panel is fully fluid between and beyond. `base.css` makes `body` a
size container (`container: panel / inline-size`), and components adapt with
`@container panel (min-width: ...)` at 300 (receipt frames side by side), 340
(controls grow, the composer is one row, footers align right) and 480 (wider
padding and bubbles, two-column prompt chips). Write the minimum-width layout
as the base rule and add what a wider panel gains in the query, so an old WebKit
without container queries still gets a working stacked layout.

## Layout

1. **360px is the reference, 260px the minimum, and it is fluid.** A docked or floating panel
   is often narrow. Nothing may wrap unpredictably, clip, or
   scroll sideways at 260px; controls collapse to icons and groups stack before
   anything overflows. At 360px and wider the layout is more horizontal
   (frames side by side, one-row composer), not stretched.
2. **Two fixed rows, one scroller.** The main surface is a header, the
   transcript, and the composer. Only the transcript scrolls; every other row
   is `flex:none`, so a row that grows eats the transcript instead of pushing
   content out of a frame nothing can scroll.
3. **Three things to do, and one of them primary.** Besides the header,
   every surface offers at most three actions: attach, model, Send in the
   composer; Apply and Discard on a plan; Save, Test, fallback in Model. Only
   the primary one is filled with the accent colour.
4. **One UI, three depths.** The same panel serves a novice, a pro, and the
   developer by how far each thing is from the surface:
   - *Novice, visible:* type, send, apply, the status banner, and what went wrong.
   - *Pro, one gesture away (hover, a menu, or Settings):* model and effort,
     what a turn cost, the Details disclosure, earlier chats, behaviour
     switches, connecting an agent.
   - *Developer, deliberately hidden:* the labelled Developer tab, where
     everything is expanded and nothing is summarised. Everyone else gets
     About & help in Settings (version, status, troubleshooting export).
5. **Group by proximity, not by boxes.** Related controls sit close
   together, groups are separated by space, and a divider is used only where
   space alone is ambiguous. No card inside a card.

## Visual system

6. **White space groups; it is not leftover.** Spacing comes from a 4px
   scale (4, 8, 12, 16, 24) and follows a rhythm: tight inside a group (4-8),
   generous between groups (12-24), and more between conversation turns than
   between messages in one turn. The density is roomy: 13px body, 30-32px
   controls, 14px card padding. Density is never bought by crushing that
   rhythm: if something does not fit, it moves a level deeper (principle 4).
7. **A small type scale and two weights.** 11px (metadata), 12px (secondary),
   13px (body and controls), 14px (titles), 16px (empty-state heading), at 400
   and 600. Hierarchy comes from size, weight and colour, not from uppercase or
   letter-spacing.
8. **Colour means something.** Violet accent means interactive or primary (and
   the user's own bubble). Green means success or live, amber needs attention
   or is in progress, red is an error or destructive action. Everything else
   is the neutral cool grey. A status is never shown in the accent colour,
   except the "Ready" chip, which is the one thing waiting for the user.
9. **Every colour is a token.** Components reference semantic variables from
   `tokens.css`. There are no hex values in `base.css`, `layout.css` or
   `components/` (the two data-URI glyphs in `composer.css` and `empty-state.css` are the only
   literals), so the palette can be retuned in one place and both themes stay
   in step.
10. **Contrast.** Primary text is 7:1 or better on its background; muted and
    faint text, accent text, status text (alone and over its soft tint) and
    white on the accent fills are 4.5:1 or better in both themes. The accent
    itself is 3:1 or better against surfaces, for rings and edges.
    `tokens-contrast.test.ts` enforces all of it.
11. **One radius scale.** 4px for small inline elements, 8px for controls,
    cards and menus, 12px for the composer, full round only for pills and dots.
12. **A cool, calm extynt look.** Cool greys, one violet accent, no decorative
    gradients or glows, hairlines over shadows (a shadow only on floating
    menus and the drawer). Bubbles: the user's message is a filled bubble on
    the right tinted with the accent; the assistant's reply is flat and full
    width.

## Controls

13. **Hit targets are 30-32px** for standalone controls and 24px for inline
    controls inside text (a notice's Review button, a usage pill).
14. **Icon-only buttons get a label.** Each one has `aria-label` and a
    `title`, uses a 16px glyph in a 30-32px target, and all glyphs share one
    stroke weight: the inline glyphs in the markup are 1.5px strokes on a 16px
    grid, and the runtime's set (`runtime/icons.ts`, filled outlines of about the same
    weight) is drawn at 16px, or 14px for the glyphs built on a 14 unit grid.
15. **Consistent states.** Default, hover, pressed, focus and disabled look
    the same on buttons, tabs, menu rows and list rows. Pressed is a 2%
    shrink and a deeper fill. Focus is always visible (a 2px accent ring) and
    never removed.
16. **Destructive actions are distinct.** Stop, Discard and Delete are red or
    ghost and never sit in the primary slot unless they replace the primary
    action while it runs, as Stop does.

## Communication

17. **One status indicator, in one place.** Status is a banner under the
    header that appears only when something needs the user: one line, at most
    one action, amber (busy, no model), grey (offline) or red (blocked, role
    alert). A healthy panel shows nothing. Shape and motion carry state as well
    as colour in the few marks that remain (the dot, the "Applying" chip).
18. **Empty states say what to do next.** A heading, one sentence, and
    concrete next actions: prompt chips that fill the composer (they never
    send), or a setup card when no model is connected. There is never a blank
    area with no guidance.
19. **Plain, sentence-case labels.** Buttons are verbs ("Apply", "Copy
    command"), headings are nouns, and no label uses all caps.
20. **Motion is functional and quiet.** Transitions are 120-160ms and use
    opacity and transform only (press shrink, drawer slide, the switch knob,
    fades). Looping marks (the live dot, the spinner, a skeleton) pulse by
    opacity or rotate. Everything is switched off under
    `prefers-reduced-motion`.

## Surfaces

- **Topbar:** the chat title as a button (it opens Chats), then New chat,
  Activity (badge counts what waits for the user) and Settings. The old
  connection dot and context line stay in the markup as `.retired` until the
  runtime stops writing to them.
- **Status banner** (`#status-banner`): see rule 17.
- **Context chip** above the composer text (`#context-chip-row`), and a faint
  caption under each user bubble (`.msg-context`) recording the context it was
  sent with.
- **Plan card:** a title that wraps to two lines, a status chip (Ready,
  Applying, Done, Done · not all checked, Didn't apply, Undone, Partly undone),
  "What will change" with up to four rows and "+N more", inline notices that
  expand in place (red errors are always open), a footer with one primary and a
  ghost Discard, a `⋯` card menu.
- **Receipt:** the same card after Apply: a done line, before and after frames
  side by side from 300px and stacked below, skeletons while they load.
- **Answer details:** one disclosure per answer holding reasoning, tools and
  usage, shown on hover or focus.
- **Drawer tabs:** Chats, Activity (Waiting for you, Changes in the project),
  Settings, Developer.
