# UI system

The rules every view follows. The tokens live in `packages/ui/src/styles/globals.css`; `cn` (`@workspace/ui/lib/utils`) knows their names, so import it from there, never from `cn` itself. A new token goes in both.

## Text: five roles

| Class              | Size and weight | For                                                        |
| ------------------ | --------------- | ---------------------------------------------------------- |
| `text-caption`     | 11/16, 500      | Eyebrows, shortcut hints, counts, badges                   |
| `text-label`       | 12/16, 500      | Field labels                                               |
| `text-body`        | 13/20, 400      | Rows, menu items, values. The `body` default               |
| `text-body-strong` | 13/20, 500      | Buttons, segments, tabs, row titles, selected object names |
| `text-title`       | 14/20, 600      | Dialog titles, panel headers. Tracked -0.005em             |

Each class sets size, line height and weight together, so don't add `font-*`, and don't use `text-xs`, `text-sm` or arbitrary sizes. 500 is a label, 400 is a value, and 600 is for titles alone. An eyebrow is `text-caption uppercase tracking-wider`; `SectionTitle` is the shared one, and `EYEBROW` is its type for a control. The Inspector's sections don't use it (§ Inspector). In dark, `SectionTitle` goes up to `text-foreground`, so a block's title stands above the field labels under it, which are `text-fg-secondary` too.

The font is the system's (`--font-sans`), so the type is never where the personality comes from. `body` sets tabular numbers. `font-mono` is Geist Mono, bundled, and is for numbers in editable fields and About's build info, never sentences, file names or paths.

## Greys: three steps below `text-foreground`

| Class               | Dark contrast on `--card` | Light contrast on `--card` | For                                                          |
| ------------------- | ------------------------- | -------------------------- | ------------------------------------------------------------ |
| `text-fg-secondary` | 9.0:1                     | 10.7:1                     | Eyebrows, section labels, field labels, inactive tabs, icons |
| `text-fg-tertiary`  | 6.4:1                     | 6.3:1                      | Placeholders, helper copy, statuses, shortcut hints, counts  |
| `text-fg-disabled`  | 3.2:1                     | 3.4:1                      | Disabled text, and what's inside a disabled row but its name |

The variables are `--fg-secondary`, `--fg-tertiary`, `--fg-disabled`. They aren't `text-secondary`: `secondary` is shadcn's surface colour. Disabled is a colour, not `opacity-50`, except on filled buttons and on graphics (a switch, a slider).

## Colour

The chrome has no hue, only elevation, and the colour on screen comes from the viewport. The game's colours stay there and in the hero band, and nothing else quotes them. Judge a change from a full-window screenshot at 100%, dark and light. If you can name any one colour in the chrome, there is too much of it. `apps/web/src/editor/palette.test.ts` holds every contrast here, and holds the surfaces under 0.012 of chroma.

| Surface        | Dark      | Light     | For                                                                       |
| -------------- | --------- | --------- | ------------------------------------------------------------------------- |
| `--background` | `#0b0d0f` | `#eef1f3` | Behind everything: the start screen, the strips, the window's edges       |
| `--card`       | `#16191c` | `#fafbfc` | Panels, bars                                                              |
| `--popover`    | `#1e2226` | `#ffffff` | Dialogs, and what `glass` is made of                                      |
| `--muted`      | one up    | one down  | The track of a segmented control, skeletons, a key chip                   |
| `--secondary`  | one up    | one down  | Secondary buttons                                                         |
| `--accent`     | one up    | one down  | shadcn's neutral surface, opaque. `--accent-foreground` is the foreground |

Both themes are one cool neutral at hue 250, lighter as they rise: `--background`, `--card`, `--popover`. In light the steps are small, `--popover` is white and `--card` only just under it, so what floats stands off a panel by its shadow and edge (§ Depth) as well as its tone. Separate things by that step first. A row or a group on a panel takes a tone, not a border; in light a raised card takes the edge too. Dark is near-black, so the window reads as black with the chrome lifting off it, and each step is 8 to 11 points. `--muted`, `--accent` and `--secondary` sit above `--popover` there, because a track or a key chip also sits on a dialog or a menu.

Components use the tokens, never a palette class (`emerald-500`) or a hex. The scene is the exception, because it draws the game's world and not the chrome: `sceneGround.ts`, `sceneColors.ts` and `axisColors.ts` keep their own colours. The clear colour is the blue a default-painted piece shows on screen (`M_BaseSurface_Metal` under the default light, OKLCH hue about 230), so the ground and the pieces read as one family: in dark that blue taken down until the pieces pop off it, with the chrome still near-black around it, and in light that blue pale and desaturated. Orthographic panes sit one step bluer (`ORTHO_GROUND`), so a side view that sees the water edge-on stays in the family of the panes that see it from above. The water has a look per theme and skips tone mapping, so its colours are what reach the screen before the map's light dims them: deep and muted in dark so the pieces pop, thicker in light so a pale piece's side faces stand off it. From above it thins out by the sky's own haze curve, so it runs straight into the horizon with no clear colour between them, and from below it thins out with distance (`water.ts`). The sky's haze over the far floor is tighter in dark, where a bright sky would otherwise light up a third of the pane (`sky.ts`). The sky runs to the top of the pane and stops there, with no fade into the chrome. The floor grid's lines fade before they get too fine to draw (`floorGrid.ts`).

A piece's thumbnail is rendered in the app on a transparent background (`editor/thumbnails.ts`), so it sits on its tile in both themes; the game's own renders are the fallback. One render at twice the largest slot (96px) serves every size, scaled down. In the Pieces panel a family's sizes draw at 60%, 80% and 100% of the tile, measured from its largest (`sizeScalesOf`), so S, M and L differ at a glance. A light has no body worth a picture, so it shows its own glyph in `text-fg-secondary` wherever a thumbnail goes (`components/outlineGlyphs.ts`). The tile is `THUMBNAIL_TILE` (`PieceThumbnail.tsx`), `bg-foreground/14`: further off the panel than `--muted`, so a white piece reads in light and a near-black one in dark.

**`--primary` is the one accent, and it means "interactive".** Dark `#05b9cf`, light `#007787`. It is for primary buttons, the active tab's underline, the active tool, selection, focus rings (`--ring` is the same value), links and the hero band's track and ball, and nothing else. In dark, `--primary-foreground` is near-black, because white on it is 2.4:1. Past sRGB this hue clips to a harsher cyan, so dark's chroma of 0.124 is the most L 0.72 holds at hue 210.

| Class           | For                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bg-primary/12` | A selection wash: selected rows, a pressed toggle. Its text keeps its colour. `bg-selected` is the same colour, for `lift-selected` |
| `bg-primary/30` | Selected text (`::selection`, set once in `globals.css`), under `--foreground`                                                      |
| `text-primary`  | Links, and any accent text: it reads on `--card` and `--popover`                                                                    |
| `bg-dirty`      | The dirty dot, and nothing else. It is the one yellow in the app. It sits on the strips, so it holds 4.5:1 on `--background`        |

`--destructive` is red, used as `text-destructive` on `bg-destructive/12`.

## Scene colours

What the editor draws over the map has one hue per meaning, so a colour says the same thing on an outline, a box, a snap mark or an open end. The roles are `SCENE_ROLES` in `editor/sceneColors.ts`, each in a dark and a light value, and each reads at 3:1 on the ground in both themes (`sceneColors.test.ts`).

| Role        | Dark      | Light     | Means                                                | Drawn on                                                                                             |
| ----------- | --------- | --------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `selected`  | `#ffb020` | `#c2500a` | What an edit acts on                                 | Selected items' outlines, a selected group's box, a snap's source, what an Align or Distribute moves |
| `active`    | `#ffe08a` | `#7a2e05` | The active item, what the gizmo and Inspector follow | Its outline: lighter than the rest in dark, darker in light                                          |
| `pointer`   | `#5ce1ff` | `#0a6f94` | What a click or a drop would act on                  | The hover, the paint tool's target, a snap's target, the open ends a drag could join                 |
| `blocked`   | `#ff5a5f` | `#c0182a` | Where the pointer's action won't go                  | The paint tool's hover on what takes no paint                                                        |
| `chain`     | `#d775f4` | `#8b1ea7` | A chain, told from a group                           | A selected chain's box                                                                               |
| `reference` | `#b69cff` | `#6236c9` | Drawn to measure by, not part of the map             | Alignment planes and guides, construction planes and lines                                           |
| `context`   | white     | `#1f2430` | Frames the work and isn't a choice                   | The entered group's box, the pivot dot                                                               |

The selection is amber because the game's own editor, Unreal, Unity and Blender all draw it so, and it stands off the blue ground and the default blue pieces. The chrome's selection stays the `--primary` wash: the chrome's cyan means "interactive", and the scene's pointer role is that same cyan, so what the pointer would act on looks the same on a row and in the viewport. Pink and magenta aren't roles: they read as errors on a blue scene and fight the game's own paints.

Shape carries what the hue can't, in one line language (`editor/screenLines.ts`):

- **Weight.** Lines are fat lines with a width in pixels, round where two meet: 2px for what is chosen (the selection's outline, a group's box, the paint tool's target), 1.5px for what only would be acted on or is behind something (the hover, a hidden part, a guide), 1px for a snap's whole box.
- **Solid** is what is there and in view.
- **Dashed** means hidden, except a group's box (below): one dash, 6px on and 4px off, measured along the line on screen, so it is the same size near and far. A straight edge fits a whole number of dashes, so it starts and ends on one and two edges meet at a corner on dashes, and the dashes stay on the line as the camera moves; a curve's dashes run on from one short edge to the next. A selected item's outline shows through what stands in front of it this way, on its side toward the camera only (`selectionOutline.ts`), the same colour at 80%, so it keeps its hue on any piece; so does a snap box's far side, and the pivot dot inside its unit is a dashed ring. A guide is dashed for the same reason a hidden line is: it isn't a thing in the map.
- **A dashed box** marks a group: its whole box, exactly on its bounds with nothing added round it, every edge dashed corner to corner in a dash of its own, 3px on and 3px off, finer than the hidden one so it reads as neither a piece nor something behind one (`groupBox.ts`). A selected group's is in the selection's colour and a selected chain's in orchid, redder than the guides' violet, so the two read apart; the entered group's or chain's is thinner, faint and in no hue.
- **Fill** is the paint tool's alone in the scene, because it picks a slot and not a piece. The hover is the outline alone, with no see-through and no fill.
- **The box or lasso region** is the one dashed line that isn't hidden: it is drawn on the pane, not in the scene, in the pointer's colour (the chrome's `--primary`), 1.5px with the same 6/4 dash, solid while it takes what is wholly inside and dashed while it takes what it touches, as 3ds Max and AutoCAD draw them (`AreaSelect.tsx`, [DESKTOP.md § Box and lasso select](../DESKTOP.md#box-and-lasso-select)). While it is dragged the outlines show what a release would select, and the hover hides.

The axes keep their own colours (`axisColors.ts`), and a hovered gizmo handle leans to a pale yellow, as in Unreal and Unity.

## Hover and press

Everything a pointer can act on answers the same way: rows, menu items, tabs, chips, segmented items, icon buttons.

| Class                 | What                                | For                                                                                       |
| --------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `hover:bg-hover`      | `--hover`, the foreground at 10%    | Anything with no fill of its own                                                          |
| `active:bg-pressed`   | `--pressed`, the foreground at 16%  | The same, held down                                                                       |
| `hover:lift-<name>`   | `--color-<name>` mixed the same 10% | A fill: `lift-primary`, `lift-secondary`, `lift-muted`, `lift-selected`, `lift-status-ok` |
| `active:press-<name>` | `--color-<name>` mixed the same 16% | The same, held down                                                                       |

A wash moves a surface a share of the way to the foreground, so every surface moves by the same share and a darker one by a few more points. Measured in the app, a hover is 20 to 23 points and a press 33 to 36, on `--background`, `--card`, `--popover` and `--muted`. Text stays readable under both (`palette.test.ts`). An opaque surface can't do this: `--accent` is nearly the tone of `--popover`, so it would vanish there and on glass. Tailwind's `hover:` is unconditional here (`@custom-variant hover`), because a window with a mouse can report `(hover: none)`.

`data-highlighted:active:bg-pressed` is how a menu row writes its press, because `data-*` variants sort after `active:`. Three things keep a look of their own. `bg-destructive/12` is a warning, and deepens to `/20`. A piece's row flashes the accent over its press, as placing it is the feedback. A panel tab goes active on pointer down, so it shows its press for no longer than that.

## Focus

Keyboard focus is one ring: 2px of `--ring`, 2px off the element, only on `:focus-visible`. It is an outline, so it follows the radius and leaves box-shadows alone, and only its style changes on focus, so a `transition-all` can't animate it. A mouse click draws nothing, except on a text field, which the browser counts as focus-visible however it got focus.

| Class               | For                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `focus-ring`        | Anything focusable. Every primitive in `packages/ui` already has it                        |
| `focus-ring-inset`  | The same ring turned inwards, for what fills a strip or a scroller that would clip it      |
| `focus-ring-within` | A field whose focus is on the input inside it: `NumberField`, a slider's thumb             |
| `focus-ring-row`    | A row whose focus is on its first child, a button. The row's other buttons ring themselves |

A dock tab takes the inset ring on dockview's own focus line (`dock.css`). On the active tab, dock or document, the ring sits at -2px, so its bottom lies on the underline and the two read as one 2px line. A 24px icon button in a tab strip or the status bar has no room for the offset, so its ring sits at -2px, its outer edge on the button's. The viewport's toolbar has `focus-ring`, but it is no Tab stop: `noFocus` keeps the keys with the viewport. The Outline is one Tab stop, the tree. A row takes focus, with the inset ring, only when Escape closes its menu.

## Borders

`--border` is an alpha hairline: white at 11% in dark, the foreground at 10% in light. A bare `border` is that at 65% (the `@layer base` default), felt rather than seen, and `border-border` is the whole hairline, for where two panels meet and for outline buttons. Panels meet with one line, not two. Nothing else gets a 1px rectangle by default.

`--input` is the well a field sits in: `bg-input` under `border-border/70`. It is alpha too (black at 24% in dark, the foreground at 3% in light), so it is a touch darker on any surface, and it isn't a border colour.

## Depth

| Class            | What                                                                      | For                                   |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------- |
| `shadow-primary` | A 1px inset highlight in white at 16%, and 1 to 2px in `--primary` at 24% | Filled primary controls               |
| `shadow-sm`      | 1 to 2px at 5%                                                            | Outline and secondary buttons, thumbs |
| `shadow-md`      | 12px at 12%, 20% in dark                                                  | Popovers, menus, tooltips, toasts     |
| `ring-edge`      | A 1px edge, `--edge`: black at 8%, the foreground at 8% in dark           | With a shadow, on whatever floats     |
| `shadow-lg`      | 24px at 12%, 20% in dark                                                  | Dialogs                               |

A raised card is `ring-edge not-dark:ring-1`: in light its tone is too near the panel's to show where it ends, and in dark the tone is enough. The start screen's and the project overview's cards stand alone (`START_CARD`), so in light they also take `shadow-md`, and in dark they keep a `border-border` hairline.

A button pressed scales to 0.97 and drops its shadow, except one that opens a popup, which holds still under it.

## Inspector

The Inspector is built from `components/InspectorLayout.tsx`, and nothing in it lays itself out another way.

- **Identity.** At the top, and never closed: a 40px tile (the piece's thumbnail, or its glyph on `THUMBNAIL_TILE`), the name in `text-title`, what kind of thing it is in `text-caption text-fg-tertiary`, and the selection's icon buttons at the right (Frame, Duplicate, Delete; a map's settings). The name of an item, a group or a map edits in place: it reads as a title until pointed at. One item's or group's tags sit under it. A group's kind leads its grey line (Group, Chain or Instance), and a selection holding a group among pieces says so ("1 group and 2 items"). Several selected name the active one, the last clicked, which the gizmo sits on and Align lines up on ("Active: Ramp"). A lone link of an entered chain adds which link it is ("Link 2 of 5"); the group entered and the way out are the Outline's breadcrumb and the status bar's.
- **Sections.** A `SectionStack` of `Section`s, with a `border-border` line across the panel between each, because a panel this long can't be held apart by space alone. A section's header is 36px: its title in `text-body-strong` with a chevron after it, and its hint, status or buttons at the right. The header opens and closes it, and the choice is kept in settings (`panels.inspectorSections`); Details starts closed. A section with nothing to edit is only its header, saying why at the right (Paint: "Not paintable"). A stack inside a section takes the same line, inside the section's padding.
- **Rows.** A value with a label is a `FieldRow`: the label in `text-label text-fg-secondary` in a 6rem column, the control in the rest, 28px tall. Facts and Lighting use the same column, so labels line up down the panel. A row that resets has the reset in a trailing column, and every row of its section has one. An X, Y, Z row is the exception: its label and clipboard button sit over its three fields, which need the width.

So the order of weight is identity name, section title, then label and value, each a step down in size, weight or grey.

## Glass

`glass` is whatever floats over content: menus, tooltips, toasts. It is `--popover` at 95% with `backdrop-filter: blur(12px) saturate(1.2)`, so what's behind is a faint tone and never a shape. Any thinner and a 3D scene shows through as a smudge, and a menu across a panel's edge takes that edge as a seam. A popover isn't glass: it is opaque `bg-popover`, because it stays open across the dock's edges and the viewport's colour would tint one side of it. A dialog isn't glass either: the overlay behind it has already blurred the page.

The viewport's own pills and chips are `SURFACE` (`viewControlStyle.ts`), `--card` at 95% over a blur, as thick as `glass`, with a hairline and `shadow-sm` so they read as one family on any scene.

Put it on the element itself. A blur on a `::before` can't see past its parent while the parent fades, so it would pop in at the end. Submenus are safe because base-ui portals them beside their parent.

## Motion

120 to 180ms, ease-out, everywhere: hover tints, press, the tab underline, the segmented pill, and a popup's fade and 4px rise. The default transition is 120ms and `cubic-bezier(0, 0, 0.2, 1)`, so a bare `transition-colors` needs nothing more, and a hover tint adds no `duration-*`. No bounce, and nothing at 300ms. Every duration goes through `--motion` (Settings › Appearance). A status chip has no transition, hover included: its label can't fade, so a fading colour would sit under the wrong label.

## Difficulty colours

`--difficulty-1` to `--difficulty-5` (`bg-difficulty-1`, `text-difficulty-5`) are the five Workshop difficulties, easiest first: white, green, blue and red bars, and an amber warning sign for Baller. They follow the game's order, quieted to sit on the chrome. The first is `--foreground`, so in the light theme it is dark. A difficulty mark uses these, never a palette class, and keeps them whether or not it is picked: the pill shows the choice, so an unpicked mark is never greyed.

## Radii: three, and the pill

- `rounded-control` (8px): buttons, inputs, menu items, the track of a segmented control.
- `rounded-surface` (10px): cards and grouped rows on a panel.
- `rounded-sheet` (12px): what floats or stands alone: dialogs, popovers, menus, tooltips, toasts.
- `rounded-full`: anything small and self-contained: tags, chips, badges, counts, the viewport toolbar and the status chip. Dots, switches, sliders and scrollbars too.

Tailwind's own names (`rounded-md`) aren't part of the system. Panels are square.

A segmented control is `ToggleGroup`, one track with a pill inside that slides to the pressed item. `pill="primary"` is for the active tool, and the neutral default is for a setting. Add `rounded-full` to the group for a pill-shaped track, and the pill and items follow. A `multiple` group has no one place to slide to, so each pressed item takes a selection wash of its own.

## Spacing: 4px steps, 8px between groups

| What               | Size                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Inputs, buttons    | 28px (`h-7`); menu items too                                                                                                       |
| Segmented control  | 28px: 24px items in a track with 2px of padding                                                                                    |
| Rows               | 24px dense (outline, thumbnails at 16px), 32px with a larger thumbnail or second line                                              |
| Rows with a tile   | 40px: a 32px thumbnail beside two lines (the Project panel)                                                                        |
| Pieces panel       | Small, Medium, Large: list thumbnails 24, 32, 48px in a row 8px taller; grid tiles 48, 64, 96px, cells 8px wider (`PIECE_LAYOUTS`) |
| Rows in a list     | 2px apart (`gap-0.5`), `rounded-control`: Project, Pieces, Prefabs. The Outline is a tree, flush and square                        |
| Icon buttons       | 24px target, 16px icon: `Button size="icon-sm"`, no size classes                                                                   |
| Panel tab strip    | 28px                                                                                                                               |
| Document tab strip | 32px, as is a popped-out panel's strip (the window controls' height)                                                               |
| Dialog padding     | `p-dialog` (16px) at every dialog size; `px-dialog` for split dialogs                                                              |
| Tooltip delay      | 300ms, the default; don't set `delay`                                                                                              |
| Tooltip side       | Down from top strips, up from the status bar; along the strip to clear a control                                                   |

## Icons

One stroke family, Tabler, at one weight: 16px in rows, 14px in chips, 20px in the toolbar. An icon takes the text colour of where it sits, never a hue of its own, except a status icon.

## Status colours

Status is semantic: a filled tint with its own text, only on badges, chips and icons, never as a surface or as the accent. The resting state of anything is the neutral tint. A sync status (`syncStatusOf`, `domain/linkState.ts`) wears one of three pairs. The text also has to read with no fill, on `--card` and `--popover`, because Settings › Game uses it alone. `SyncStatusChip.tsx` is the one place that picks between them for a status; `Badge` has `variant="warn"` and `"neutral"` for a tag that isn't one.

| Fill                | Text                             | For                                                          |
| ------------------- | -------------------------------- | ------------------------------------------------------------ |
| `bg-status-ok`      | `text-status-ok-foreground`      | In sync, Saved                                               |
| `bg-status-warn`    | `text-status-warn-foreground`    | Unsaved, Changed since export                                |
| `bg-status-neutral` | `text-status-neutral-foreground` | Not exported, Published draft, an Export or a Play under way |

Not exported is every map's resting state, so it wears neutral, the quietest pair: colour means something needs a look or has just gone right. The variables are `--status-ok`, `--status-warn`, `--status-neutral`, and each with `-foreground`. Each is the tint already mixed with the surface, about 12% in light and 18% in dark, where the text is at full saturation, and opaque, so a hover is `lift-status-ok` like any other fill. Neutral has no hue to tell it from a selection wash, so in light it sits a tone step down, to hold 1.2:1 on an active row.
