# UI critique, round 6

Reviewer: Robin Ebers (role-played). Build: `feat/ui-redesign` at `ee8ddb720`, desktop app, 1723×1078 CSS px window. Screenshots: `/home/spigelli/.cache/ballest-editor/ui-critique-round-6/shots/` (469 files, every surface in dark and light with `-light` twins; full-window pairs `100-editor-map` through `115-editor-dirty`; `MANIFEST-A..D.md` with menu dumps, bug-check results, chip timings and the measured colours). Earlier rounds: `ui-critique-round-1.md` to `ui-critique-round-5.md`. System: `ui-system.md`.

Same scale. Theme judged by rule 12 from full-window shots at 100%; dark judged against the nine properties set in round 5.

## Scoreboard

| View                                    | R1 | R2 | R3 | R4 | R5 | R6    | T     | One line                                                                                                                                                                             |
| --------------------------------------- | -- | -- | -- | -- | -- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overall                                 | 4  | 6  | 5  | 7  | 8  | **8** | 8     | Dark is now the theme the owner asked for. Every round-5 item is verified. What is left is a handful of behaviour bugs and the dark viewport's black band.                           |
| Theme                                   | –  | –  | 2  | 7  | 7  | –     | **8** | Dark 8, light 8. Near-black base, three readable levels, a teal that glows, saturated status pills. The dark water fade passes through black and the light dirty dot is under 4.5:1. |
| Top bar and menu bar                    | 5  | 7  | 8  | 8  | 8  | 9     | 8     | Play tooltip opens into the bar; nothing covered.                                                                                                                                    |
| Dock                                    | 4  | 6  | 7  | 8  | 8  | 9     | 8     | Active-tab click keeps the selection (round 5's report was my harness hitting the list region).                                                                                      |
| Viewport chrome                         | 5  | 7  | 8  | 8  | 8  | 8     | 8     | Pane tooltips show their own keys. Toolbar still on the four-pane divider; accepted.                                                                                                 |
| Inspector: map                          | 4  | 6  | 7  | 8  | 8  | 8     | 8     | Fine.                                                                                                                                                                                |
| Inspector: item and group               | 3  | 7  | 8  | 8  | 8  | 8     | 8     | Fine.                                                                                                                                                                                |
| Outline                                 | 5  | 7  | 8  | 9  | 9  | 9     | 8     | KeyChips in the context menu.                                                                                                                                                        |
| Pieces                                  | 4  | 7  | 8  | 8  | 8  | 8     | 8     | Lights have glyphs; rejected tooltips read as user copy. First placed piece can land off screen.                                                                                     |
| Prefabs                                 | 4  | 6  | 7  | 8  | 8  | 8     | 8     | ⋯ on hover, eyebrow keeps the name's case. Place in map ignores existing items.                                                                                                      |
| Project panel                           | 4  | 6  | 7  | 8  | 8  | 8     | 8     | Fine.                                                                                                                                                                                |
| Status bar, sync, notifications, toasts | 5  | 6  | 7  | 7  | 8  | 8     | 8     | Saved runs 2.0 s, no flash, popover clears the toolbar with a body line. Chip lags undo by ~2 s.                                                                                     |
| Menus (content)                         | 5  | 7  | 8  | 8  | 8  | 9     | 8     | Hover rows read as a full step.                                                                                                                                                      |
| Settings › Game                         | 3  | 7  | 8  | 8  | 8  | 8     | 8     | Fine.                                                                                                                                                                                |
| Settings dialog                         | 5  | 7  | 8  | 8  | 8  | 9     | 8     | Three levels visible in one frame.                                                                                                                                                   |
| Project settings                        | 4  | 6  | 8  | 8  | 8  | 8     | 8     | Fine.                                                                                                                                                                                |
| Save, Rename, Duplicate, New project    | 3  | 8  | 8  | 8  | 9  | 9     | 8     | Fine.                                                                                                                                                                                |
| Backups                                 | 3  | 7  | 8  | 8  | 8  | 8     | 8     | Fine.                                                                                                                                                                                |
| Start screen, Where to open             | 4  | 6  | 7  | 8  | 8  | 9     | 9     | Teal line and ball on near-black is the best frame in the app.                                                                                                                       |
| Keyboard shortcuts                      | 6  | 7  | 8  | 8  | 8  | 8     | 8     | Fine.                                                                                                                                                                                |
| Split panes                             | 5  | 6  | 7  | 7  | 7  | 8     | 8     | Light ortho panes now a family with the water.                                                                                                                                       |
| Prefab definition tab                   | 4  | 7  | 8  | 8  | 8  | 8     | 8     | Light prefab side faces read against the darker water.                                                                                                                               |
| Light theme                             | 2  | 6  | 7  | 6  | 8  | 8     | 8     | Dirty dot at 3.3:1 is the one contrast miss.                                                                                                                                         |
| Display popover                         | –  | 5  | 7  | 8  | 8  | 8     | 8     | Fine.                                                                                                                                                                                |
| About dialog                            | –  | 4  | 8  | 8  | 8  | 8     | 8     | Fine.                                                                                                                                                                                |

## What got fixed (verified)

- **Dark, bolder.** Measured: base `rgb(11,13,15)`, panels `rgb(22,25,28)`, menus and dialogs `rgb(30,34,38)`, border white 11%, text tiers 16.4 / 9.0 / 6.4:1, accent `rgb(4,185,207)`, status pills with saturated foregrounds (`zoom-c-status-pills.png`), dirty dot `rgb(245,206,13)`, hover a visible step (`zoom-a-hover-row.png`). The three levels read in one frame (`zoom-d-three-levels.png`). The `:root` light block is unchanged.
- **Light viewport**: ortho panes tinted toward the water (`103-editor-four-panes-light.png`), water a step darker so the prefab reads (`111-editor-prefab-tab-light.png`).
- Pane picker tooltips show their own keys; Play and tab tooltips cover nothing; sync popover clears the toolbar and has a body line; KeyChips in context and tab menus; ⋯ on prefab and project rows; seven distinct Lights glyphs; Saved chip 2.0 s with no "Not exported" flash and re-save goes Unsaved → Saved; placement avoids existing footprints for pieces placed from the panel; "Instance of asdf" keeps the name's case; the three rejected tooltips are user copy; "Not exported" popover has a body line; undo to the saved state clears the dot; the document cannot scroll.
- **Not a bug**: the round-5 "active Outline tab clears selection" was my agent clicking the list region, which deselects by design. A real tab click keeps the selection (`95-active-tab-click`).

## Theme

### Dark (8)

`100-editor-map.png`, `101-editor-item.png`, `104-editor-menu-open.png`, `105-editor-settings.png`, `115-editor-dirty.png`, `80-start-screen.png`. The window reads as black with the chrome lifting off it; menus and dialogs are a clear third level; the teal Play button, active tool and tab underline glow; the amber Unsaved pill and yellow dirty dot are vivid; the start screen's teal line on near-black is the strongest frame the app has had. Against the nine properties:

| Property        | Asked                | Measured                              | Verdict                    |
| --------------- | -------------------- | ------------------------------------- | -------------------------- |
| Base            | ~rgb(10,12,14)       | rgb(11,13,15)                         | Met                        |
| Elevation steps | 8 to 10 points       | 11 then 8                             | Met                        |
| Hairlines       | white 10 to 12%      | 11%                                   | Met                        |
| Text tiers      | three clear          | 16.4 / 9.0 / 6.4                      | Met                        |
| Accent          | oklch ~0.72 0.16 210 | 0.72 0.124 (gamut limit)              | Met, as far as sRGB allows |
| Status pills    | saturated            | yes                                   | Met                        |
| Hover           | a full step          | +13 card, +17 menu                    | Met                        |
| Viewport darker | yes                  | clear rgb(14,16,19), water to #0e4a64 | Met, with one fault        |
| Light untouched | yes                  | byte-identical                        | Met                        |

The one fault: **the dark water fade passes through black** before the teal begins, so the upper third of the viewport is a flat black band under the cream horizon (`100-editor-map.png`, `zoom-d-water-horizon.png`). The grid lines are the only thing in it. Fade from the water colour straight to the clear colour without dipping below both, or shorten the fade so the teal reaches the horizon haze.

Two smaller notes: the eyebrow caps (MAP, TRANSFORM, PIVOT) are the same tertiary grey as the labels and could sit one tier up now that the base is darker; and the grey swatch in the Paint row is the only neutral in a row of saturated circles and reads as disabled.

### Light (8)

Unchanged chrome, fixed viewport. **The dirty dot is 3.3:1 on the light panel** (`rgb(245,206,13)` on white): it needs a darker yellow in light, around `#b8860b`, or an outline. That is the only contrast miss left in either theme.

### Both

The notifications popover in light keeps a faint blue tint on its left edge (7 levels at most), probably the dock edge through 95% glass; raise popovers over the dock to 100% or ignore it.

## Bugs found this round

1. **First placed piece can land off screen.** From the default camera, Curve 1 Medium lands at (-1613, -416) where round 5 put it mid-view; clicking the row changes nothing visible, only the inspector and the dot. Curve 1 Small still lands mid-view, so the footprint avoidance from item 7 is skipping slots that would touch the Goal and walking the wider piece out of view. Fall back to the nearest free slot inside the frustum, or frame the new piece.
2. **Status chip lags undo by about 2 s**: title and tab dot clear at once, the chip says Unsaved for ~2.0 s; on three launches it also read Unsaved on a clean map for ~1.5 s.
3. **Place in map (prefab) ignores existing items**: the instance lands over the first Kicker and hides the Goal. Item 7 covered panel placement only.
4. **Sync chip changes label before colour**: a frame of "Not exported" in Saved's green, and "Saved" in amber, during the fade (`115b-editor-saved-chip`, `73c-status-saved`). Crossfade label and colour together, or swap the label at the midpoint.
5. **Saving rewrites `createdAt`**: the inspector's Created date moved from Nov 5 to Nov 6 after a save. FORMAT.md says the game sets it on open, so this may be intended; if so the row should say "Opened".
6. **Spellcheck in the Pieces search field** ("zzz" gets a red squiggle). Set `spellcheck={false}` on filter inputs.
7. **Pane picker tooltips cross pane edges** (Perspective and Front spill 19 px over the left dock). Cosmetic.
8. Still accepted: the toolbar on the four-pane vertical divider; the 80 px left of the logo is reserved for native window controls that CDP does not draw.

## Per view (deltas only)

### Viewport chrome (8, T 8)

Pane keys correct. Bug 7.

### Pieces (8, T 8)

Lights glyphs are distinct and themed (`29h-lights-category.png`). Near-tone tiles read, with Tech Subtle in dark the weakest. Bug 1 is the one real fault and it is a placement bug, not a panel one.

### Prefabs (8, T 8)

Bug 3.

### Status bar (8, T 8)

Three pills, each its own colour, 2.0 s Saved. Bugs 2 and 4.

### Start screen (9, T 9)

Nothing to add.

## What to do next, by score impact

1. **Dark water fade**: no black band between the horizon haze and the water.
2. **First placement in view** (bug 1) and **prefab placement avoids items** (bug 3).
3. **Chip timing**: clear on undo at once (bug 2); crossfade label with colour (bug 4).
4. **Light dirty dot** to 4.5:1.
5. **Created vs Opened** (bug 5); spellcheck off on filters (bug 6).
6. Eyebrows one tier up in dark; the grey paint swatch styled as a colour, not a disabled state.

## Not reviewed

Native prompts, Import clash / Overwrite / Replace published, Release notes (external), update pill, popped-out panels, Game link first-run when something is missing, drag-and-drop, splitter dragging, gizmo interaction, exported and changed-in-game chip states.
