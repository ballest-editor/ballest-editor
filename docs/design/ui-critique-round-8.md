# UI critique, rounds 7 and 8

Reviewer: Robin Ebers (role-played). Build: `feat/ui-redesign` at `58680f5a3`, desktop app, 1723×1078 CSS px window. Screenshots: `/home/spigelli/.cache/ballest-editor/ui-critique-round-8/shots/` (643 files, every surface in dark and light with `-light` twins; full-window pairs `100-editor-map` through `118-editor-validate`; `MANIFEST-A..D.md` with menu dumps, measured lifts, contrast, chip widths and every bug-check result). Earlier rounds: `ui-critique-round-1.md` to `ui-critique-round-6.md`. System: `ui-system.md`.

Rounds 7 (the round-6 next-steps) and 8 (the "8 to 9" items) shipped together, so they share a column. Same scale; Theme by rule 12 from full-window shots at 100%.

## Scoreboard

| View                                    | R1 | R2 | R3 | R4 | R5 | R6 | R7/8  | T     | One line                                                                                                                                                                                                                            |
| --------------------------------------- | -- | -- | -- | -- | -- | -- | ----- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall                                 | 4  | 6  | 5  | 7  | 8  | 8  | **9** | 9     | All six round-7 items and 46 of 48 round-8 items verified. The app now does things a shipping tool does: scrub, relative entry, drag-to-place, a view cube, backup diffs, buffered settings. Two views stay at 8 for reasons below. |
| Theme                                   | –  | –  | 2  | 7  | 7  | 8  | –     | **9** | Dark: black base, three levels, one ring, one hover lift, vivid status, no horizon band, measured. Light: the same system on paper-white with real shadows. Light's card and popover share one white, which the edge line carries.  |
| Top bar and menu bar                    | 5  | 7  | 8  | 8  | 8  | 9  | 9     | 9     | Fine.                                                                                                                                                                                                                               |
| Dock                                    | 4  | 6  | 7  | 8  | 8  | 9  | 9     | 9     | Fine.                                                                                                                                                                                                                               |
| Viewport chrome                         | 5  | 7  | 8  | 8  | 8  | 8  | 9     | 9     | Corner card with height and distance, a clickable axis gizmo with a tween, tool strip under the panes.                                                                                                                              |
| Inspector: map                          | 4  | 6  | 7  | 8  | 8  | 8  | 9     | 9     | Creator chip, Validate → "Valid · 1 warning" with a disclosure, time-of-day swatch. Validate result resets on selection (bug 3).                                                                                                    |
| Inspector: item and group               | 3  | 7  | 8  | 8  | 8  | 8  | 9     | 9     | Scrub with Shift and Alt, `+100` `*2` `=-20`, group card with Frame.                                                                                                                                                                |
| Outline                                 | 5  | 7  | 8  | 9  | 9  | 9  | 9     | 9     | Fine.                                                                                                                                                                                                                               |
| Pieces                                  | 4  | 7  | 8  | 8  | 8  | 8  | 9     | 9     | Drag ghost lands at the drop point, Recent and Favourites persist, S/M/L scale in the tile.                                                                                                                                         |
| Prefabs                                 | 4  | 6  | 7  | 8  | 8  | 8  | 9     | 9     | Whole-definition thumbnail, "n placed" selects, prefilled name, Used in, instance banner, "2 instances updated".                                                                                                                    |
| Project panel                           | 4  | 6  | 7  | 8  | 8  | 8  | 9     | 9     | Thumbnails, "Edited n min ago", middle-click opens behind, drag to the strip opens.                                                                                                                                                 |
| Status bar, sync, notifications, toasts | 5  | 6  | 7  | 7  | 8  | 8  | 9     | 9     | Selection summary, one chip width (141 px), progress in the chip by code. A group reads "2 items · 1 group" not its name.                                                                                                           |
| Menus (content)                         | 5  | 7  | 8  | 8  | 8  | 9  | 9     | 9     | Fine.                                                                                                                                                                                                                               |
| Settings › Game                         | 3  | 7  | 8  | 8  | 8  | 8  | 9     | 9     | Breadcrumb paths with Copy path, distinct Reveal and Choose glyphs, Install on a missing plugin by code.                                                                                                                            |
| Settings dialog                         | 5  | 7  | 8  | 8  | 8  | 9  | 9     | 9     | Fine.                                                                                                                                                                                                                               |
| Project settings                        | 4  | 6  | 8  | 8  | 8  | 8  | 9     | 9     | Buffered with a sidebar dot, Save/Revert, Escape asks; difficulty slider; "Gameplay · 3 of 16" with Clear. Tags stay dirty after toggling back (bug 4).                                                                             |
| Save, Rename, Duplicate, New project    | 3  | 8  | 8  | 8  | 9  | 9  | 9     | 9     | Fine.                                                                                                                                                                                                                               |
| Backups                                 | 3  | 7  | 8  | 8  | 8  | 8  | 9     | 9     | Preview render, "5 items · Nov 6, 3:28 AM · 8.5 KB", "−1 item · 1 moved", Restore as new.                                                                                                                                           |
| Start screen, Where to open             | 4  | 6  | 7  | 8  | 8  | 9  | 9     | 9     | Fine.                                                                                                                                                                                                                               |
| Keyboard shortcuts                      | 6  | 7  | 8  | 8  | 8  | 8  | 9     | 9     | Filter, inline rebind shared with Settings, platform label from one source.                                                                                                                                                         |
| Split panes                             | 5  | 6  | 7  | 7  | 7  | 8  | 8     | 9     | Maximise, swap, per-pane overrides and persisted sizes all work. A maximised pane is indistinguishable from One pane (bug 1); that is the gap.                                                                                      |
| Prefab definition tab                   | 4  | 7  | 8  | 8  | 8  | 8  | 9     | 9     | Fine.                                                                                                                                                                                                                               |
| Light theme                             | 2  | 6  | 7  | 6  | 8  | 8  | 8     | 8     | Dot 5.24:1, accent 4.63:1, 12% shadow and 8% edge on menus. Card and popover are the same white (gap below); disabled text 2.67:1.                                                                                                  |
| Display popover                         | –  | 5  | 7  | 8  | 8  | 8  | 9     | 9     | GIZMO group with size and Show for groups, inline grid swatches with reset, Reset to defaults.                                                                                                                                      |
| About dialog                            | –  | 4  | 8  | 8  | 8  | 8  | 9     | 9     | Build block with Copy, inline update check, 141 licences in a list.                                                                                                                                                                 |

## What got verified

Round 7, all six: dark water runs into the haze with no band (top 20 px samples 14,16,19 flat, `zoom-d-water-horizon.png`); light dirty dot 5.24:1; eyebrows one tier up; swatches ring at 35%; popovers opaque; first placement in view at (-2405,-2792) and prefab placement clear of items; chip follows the dirty flag at once (0 frames of Unsaved after undo, label and colour in one frame); Created stable across saves; spellcheck off on filters; tooltips inside the viewport.

Round 8, 46 of 48: every item in the "What separates 8 from 9" section was found on screen or by measurement. Notes rather than failures: the hover lift is 19 to 24 per channel rather than one number, because alpha washes land differently on different surfaces; S/M/L tiles measure 67 / 87 / 100% by silhouette rather than 60 / 80 / 100, and still read as three sizes; the time-of-day swatch sits above the thumb rather than the pointer; Check for updates is disabled in a dev build; the ⌘ label is unchecked on Linux. Not verifiable here: Export progress and the plugin Install row (accepted by code review, as the brief allowed).

## Theme (9)

Dark, measured: body `11,13,15`, panel `22,25,28`, popover `30,34,38`, border white 11%, hover +19 to +24, pressed +33 to +36, text tiers 16.4 / 9.0 / 6.4:1, dirty dot 11.5:1, one 2 px ring at 2 px offset on every Tab stop and none on click. From the full-window pairs (`100-editor-map.png`, `115-editor-dirty.png`, `116-editor-group.png`, `103-editor-four-panes.png`) it reads as a black tool with one teal, one amber and one yellow, and every piece of chrome that floats has a visible edge. The corner gizmo's six coloured discs are the one new saturated element and they belong there.

Light, measured: panel `#eef1f3`, card and popover white, accent 4.63:1, dot 5.24:1, menus with a 12% shadow and 8% edge (`zoom-d-light-menu-edge.png` reads crisp). Two things keep light at 8: card and popover are both `oklch(1 0 0)`, so the three-level check fails and only the edge separates a popover from the panel it sits on (`zoom-d-three-levels-light.png`); and disabled text is 2.67:1, under the 3:1 floor for disabled. Make the card `#fafbfc` and keep popovers white, and lift disabled to about `#9aa0a6`.

## Bugs found this round

1. **A maximised pane has no cue.** Double-click maximises, but the result is pixel-identical to One pane: the Panes button reads "One pane", there is no restore control and no badge (`117-editor-pane-max.png`, `37c-pane-maximised.png`). Show "Maximised · Esc to restore" in the pane's picker label or a chip under it, and make the Panes button read "Four panes (maximised)".
2. **Ctrl+A selects the whole UI as text.** No select-all action exists, so the key falls through to Chromium and highlights 290 characters of chrome; Ctrl+G then has nothing to group (`138-ctrl-a-selects-ui`). Bind Select all to the editor (and add it to Edit), and `user-select: none` on the chrome.
3. **Validate's result is lost on any selection change.** Select the Goal and deselect; the row returns to the Validate button though the document has not changed. Keep the result until the next edit.
4. **Workshop tags stay dirty** after a tag is toggled on then off, or after Clear, so Save and Revert stay enabled with nothing to save. Compare to the saved state, not to "touched".
5. **Spellcheck on the map Name field** and five numeric fields (the three lighting values, grid size, rotation step): "asdf" gets a red squiggle once focused (`125-name-field-squiggle`). Round 7 fixed the filters only.
6. **A dropped piece does not keep clear of items**: Curve 1 M dropped at the Player Start lands 115 cm from it and hides the disk. Clicking keeps clear; dropping should too, or at least nudge up.
7. **The tab strip's drop zone is narrower than the strip**: a row dropped past the + at x > 399 does nothing and says nothing. Extend the zone to the strip's width.
8. **Grid vanishes during the gizmo tween** (`123-gizmo-tween-2`); seen with the clock slowed 12×, so confirm on a GPU before chasing.
9. Minor: the dock tab's focus ring merges with the active underline into one 8 px bar; strip icon buttons sit at +2 px instead of the documented −2 px; the Editor plugin row's Copy path sits in the pencil's column; the "(backup)" tab name truncates early against its badge; a selected group reads "2 items · 1 group" in the status bar rather than "Group"; the Right view's corner card shows "1 px = 1.8 cm" at a different zoom from the others after a gizmo snap.

## Remaining gaps for the two views under 9

### Split panes (8)

The mechanics are all there and all work. The one thing that holds it back is bug 1: a maximised pane must look maximised. One line in the picker, one restore affordance, and the Panes button reporting the real layout. Verify: `117-editor-pane-max.png` differs from `100-editor-map.png` in the picker label and the Panes button text.

### Light theme (8)

1. **Three levels.** Card `#fafbfc`, popover `#ffffff`, panel `#eef1f3`. Verify: `zoom-d-three-levels-light.png` shows three distinguishable greys without relying on the edge.
2. **Disabled text at 3:1.** `#9aa0a6` on white is 3.0:1. Verify: measure a disabled menu item.
3. **Shadows on cards too.** Menus have the 12% shadow and 8% edge; the inspector's raised cards and the start screen's cards still sit flat on the panel. Give cards the edge at least. Verify: `80-start-screen-light.png` cards have a visible boundary.

## Per view (deltas only)

### Viewport chrome (9)

The corner card ("9.3 m up · 19.8 m to Goal") and the six-disc gizmo are the best additions this round. The tool strip under the panes finally puts the toolbar off the splitter. Bug 8 to confirm.

### Inspector: map (9)

Creator chip with an avatar and an 18-character truncation; Validate runs and reports; the swatch on the time-of-day track. Bug 3.

### Inspector: item and group (9)

Scrub, relative entry and the group card are exactly as specified. The axis tabs at 85% chroma now sit with the gizmo discs as one family.

### Pieces (9)

The drag ghost is a 48 px tile that follows the pointer and the piece lands under it. Recent and Favourites reorder only after the pointer leaves the panel, which is the right call. Bug 6.

### Prefabs (9)

"Used in · asdf" as a link, the instance banner over the viewport, and "2 instances updated" on save close the loop between definition and instances.

### Project panel (9)

Thumbnails appear after the first save, with the glyph until then. Middle-click and drag both work. Bug 7.

### Status bar (9)

"Curve 1 Small", "2 items", "3 items · 1 group" at the left; the chip is one width in all states. A group should read by name.

### Project settings (9)

Buffered edits with a dot, Save and Revert, and a "Save your changes?" prompt on Escape. The difficulty slider with the game's bars under each stop is clear. Bug 4.

### Backups (9)

The preview, the one-line summary and the diff turn this from a list into a tool.

### Keyboard shortcuts (9)

Filter and inline rebind; the rebind is reflected in Settings › Keybinds.

### About (9)

Build block, Copy, update check with its reason when disabled, 141 licences with their SPDX ids.

## What to do next, by score impact

1. **Maximised pane cue** (bug 1) and **light card tone, disabled text and card edges** (light theme gaps). These are the two rows under 9.
2. **Select all** bound and chrome `user-select: none` (bug 2).
3. **Validate result persists until the next edit** (bug 3); **tags dirty by comparison** (bug 4).
4. **Spellcheck off** on Name and numeric fields (bug 5).
5. **Dropped pieces keep clear** (bug 6); **tab strip drop zone** (bug 7).
6. **Group name in the status bar**; the minor alignment items in bug 9.
7. Confirm the gizmo tween grid on a GPU (bug 8).

## Not reviewed

Native prompts, Import clash / Overwrite / Replace published, Release notes (external), update pill, popped-out panels, Game link first-run when something is missing, splitter dragging, gizmo handle interaction, exported and changed-in-game chip states, Export progress in the chip.
