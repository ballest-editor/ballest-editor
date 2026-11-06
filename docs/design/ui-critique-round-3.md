# UI critique, round 3

Reviewer: Robin Ebers (role-played). Build: `feat/ui-redesign` at `aed9982f2`, desktop app, 1723×1078 CSS px window, dark unless noted. Screenshots: `/home/spigelli/.cache/ballest-editor/ui-critique-round-3/shots/` (211 shots from four parallel agents; same names as rounds 1 and 2 where the view matches, `-light` twins for the Theme row, `MANIFEST-A..D.md` with menu dumps, measured colours and bugs). Earlier rounds: `ui-critique-round-1.md`, `ui-critique-round-2.md`. System: `ui-system.md` (now with a Colour section).

Same scale as before, out of 10 against a shipping professional tool. New this round: **Theme** is a scored criterion with the same weight as any other. It judges palette, backgrounds, shading, icons and overall feel, loosely reminiscent of _Ballest of Them All_, with the explicit calibration that overreach is a fault: the game's palette should inform accents, status colours and surfaces, not turn a professional tool into game chrome. Both light and dark must exist and both must be good. Each view below carries a theme sub-score (T) next to its round-3 score.

## Scoreboard

| View                                    | R1 | R2 | R3    | T     | One line                                                                                                                                                                                                           |
| --------------------------------------- | -- | -- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overall                                 | 4  | 6  | **7** | 7     | The app has a face now. Navy and goal-yellow are used with restraint, both themes hold up, and nearly every round-2 item landed. What remains is a short list of behaviour bugs and theme tuning, not design debt. |
| Theme (new)                             | –  | –  | –     | **7** | Dark is a real identity, light is a real second palette. Fix the yellow-on-navy wash, the viewport blues not matching the chrome, and the few places where primary yellow lands on things that are not actions.    |
| Top bar and menu bar                    | 5  | 7  | 8     | 8     | Logo in the bar, Play is yellow, menus are navy/blur. Recent projects has no reason tooltip.                                                                                                                       |
| Dock                                    | 4  | 6  | 7     | 7     | Sash and hover-shift fixed. Reopened panels land last; Untitled project panel shows a row and "No maps yet" together.                                                                                              |
| Viewport chrome                         | 5  | 7  | 8     | 7     | Panes and Display are labelled, Display owns the toggles, controls pinned above panes, splitter highlights.                                                                                                        |
| Inspector: map                          | 4  | 6  | 7     | 7     | Absolute date, Status ⓘ. Creator still an unbroken 29-char token.                                                                                                                                                  |
| Inspector: item and group               | 3  | 7  | 8     | 7     | Finish always has a value, swatch row, X/Y/Z tabs in the game's RGB. Flip and Pivot read fine.                                                                                                                     |
| Outline                                 | 5  | 7  | 8     | 7     | Glyphs, selection in a warm wash. Thumbnails for pieces are still the preferred direction (see Pieces).                                                                                                            |
| Pieces                                  | 4  | 7  | 8     | 8     | Size tags coloured by S/M/L, grid outlines match. Sort order S/M/L inconsistent across families.                                                                                                                   |
| Prefabs                                 | 4  | 6  | 7     | 7     | Empty state centred. "Stored in" toggle has almost no pressed state; a raw class name in a tooltip.                                                                                                                |
| Project panel                           | 4  | 6  | 7     | 7     | One badge vocabulary, coloured. Unsaved orange and Not exported blue are good; "Not exported" is the resting state and should be quieter.                                                                          |
| Status bar, sync, notifications, toasts | 5  | 6  | 7     | 7     | Chip is coloured per state. Never-saved map shows plain text, not a chip.                                                                                                                                          |
| Menus (content)                         | 5  | 7  | 8     | 8     | Theme gone from View, Display toggles gone from View. Re-import still has no reason.                                                                                                                               |
| Settings › Game                         | 3  | 7  | 8     | 7     | Reveal vs Choose with distinct glyphs and tooltips.                                                                                                                                                                |
| Settings dialog                         | 5  | 7  | 8     | 7     | Version row gone, search footer right, "on this computer". Stale Keybinds scrollbar.                                                                                                                               |
| Project settings                        | 4  | 6  | 8     | 7     | Workshop nested under its map with a breadcrumb, difficulty tooltips with the game's bars.                                                                                                                         |
| Save, Rename, Duplicate, New project    | 3  | 8  | 8     | 8     | Unchanged and right. Light twins hold up.                                                                                                                                                                          |
| Backups                                 | 3  | 7  | 8     | 7     | Title matches the menu, sized to content.                                                                                                                                                                          |
| Start screen, Where to open             | 4  | 6  | 7     | 8     | Hero band with the track and ball, centred, last-opened in rows. Light has a paint artefact on the New project card under SwiftShader.                                                                             |
| Keyboard shortcuts                      | 6  | 7  | 8     | 7     | Editor / Move / Keyboard shortcuts; one Camera section.                                                                                                                                                            |
| Split panes                             | 5  | 6  | 7     | 6     | Controls pinned; splitter visible. Ortho panes in dark are a cold slate that fights the navy chrome.                                                                                                               |
| Prefab definition tab                   | 4  | 7  | 8     | 7     | Fine.                                                                                                                                                                                                              |
| Light theme                             | 2  | 6  | 7     | 7     | Warm paper, navy ink, gold primary. Grid now readable. Water in the perspective pane is a saturated sky-blue that clashes with the paper.                                                                          |
| Display popover                         | –  | 5  | 7     | 7     | Labelled trigger, right glyph, Grid height moved in, link to grid colours.                                                                                                                                         |
| About dialog                            | –  | 4  | 8     | 8     | Hero strip, Copy, links, licence.                                                                                                                                                                                  |

## What got fixed (verified in the shots)

- All three input bugs from round 2: the sash no longer intercepts menus (measured by two agents), tabs reserve the close slot, the pane picker closes on choice.
- "Created" shows an absolute date; the UTC/local mismatch is gone.
- One badge vocabulary: `Unsaved` (orange), `Not exported` (blue), with the same background in the status chip and the row (`61c-project-status-badges.png`, `zoom-badges.png`).
- Display popover is the one home for Show grid / sky / water / Map lighting and Grid height; View and Settings › Appearance no longer carry them (`90-display-popover.png`, `04c-menu-View.png`).
- Viewport controls pinned to the viewport corner in every pane layout; splitter brightens on hover (measured 86/122/145 → 198/211/223).
- Start screen: centred hero band, logo, tagline, New / Open, recent rows with ⋯, a What's new card (`80-start-screen.png`). Where to open has New window as the primary.
- Copy: Move, Keyboard shortcuts, Editor, one Camera section, "on this computer", search footer, Version row gone, × n only above 1, Finish shows a value, Status ⓘ.
- Workshop nested under its map (`17d-project-settings-workshop.png`, breadcrumb "Project settings › Harbor Loop › Workshop"); difficulty tooltips name the game's bars.
- Light theme grid lines readable; ortho panes tinted; About has content.

## Bugs found this round (fix before polish)

1. **Editor shortcuts die after Escape closes a menu.** Focus returns to the menubar button and `isEditorKeyEvent` drops keys from inside `[role=menubar]`. Ctrl+G did nothing twice until the button was blurred. Every editor key is affected, and Escape-out-of-a-menu is something users do constantly.
2. **Untitled project panel shows both states.** An "Untitled · Unsaved" row and, below it, "No maps yet / New map" (`06-panel-PROJECT.png`). One or the other.
3. **Reopened panels land last in the strip** (Prefabs after Outline); only Reset layout restores the order. Remember the slot.
4. **Raw class name in a tooltip**: "MP_PlayerStart is forbidden in prefabs." Say "Player Start can't go in a prefab."
5. **Stale Settings scrollbar**: after visiting Keybinds, its scrollbar persists on pages that don't scroll until the dialog is reopened.
6. **No reason tooltip on disabled File › Recent projects** (the source has one; it never showed), and none on Project › Re-import from game.
7. **Never-saved map shows plain text in the status bar** ("Not saved in the project yet") instead of the `Unsaved` chip the row uses, and clicking it does nothing.
8. **Prefab thumbnail flashes a broken-image glyph** for ~0.8 s on first view.
9. **Light New project card paints a hard-edged teal band** under SwiftShader (`81-start-screen-new-project-light.png` vs `-repainted`). The `from-accent/15 to-accent/5` gradient over `bg-card` is the suspect; verify on a real GPU before dismissing.
10. **Hard-killed app comes back Light** after Dark was chosen (unflushed localStorage). Probably harness only; worth a clean-quit check.
11. Minor: placed pieces stack on the same spot; Curve 2 sorts M, S, L while Curve 1 sorts S, M, L; the hidden "More for asdf" 1×1 button still exists in the tab strip; two Hidden rows have empty thumbnails in search.

## Theme, in detail

This is the new row, so it gets its own section. The brief was: prettier, loosely reminiscent of the game, not game-styled chrome, both themes real.

**What works.**

- The palette is derived, not pasted. Navy stadium surfaces, goal-yellow as the one accent, teal for the second colour, and the status/difficulty/size tokens all from the same family. In the editor the yellow appears exactly where an action or a selection is: Play, the active tool, the active tab underline, primary buttons, the dirty dot. That is restraint.
- Surface hierarchy by tone: background → card → popover get lighter as they rise, in both themes. Menus are popover at 70% over a blur and read as floating without a heavy shadow (`04-menu-File.png`, `38-light-menu.png`).
- Light is a separate palette, not an inversion: warm paper, navy ink, a deeper gold that passes contrast as a fill. Settings, dialogs and panels in light look like the same product (`20-settings-General-light.png`, `71-save-map-named-project-light.png`).
- The hero band on the start screen and About is the only place the game shows up as illustration, and it is a line drawing of a track and a ball, not a screenshot. That is exactly the right dose (`80-start-screen.png`, `91-about-dialog.png`, `38-light-about.png`).
- Size tags S/M/L in dawn tints and grid thumbnails outlined in the same tint (`29b-pieces-grid.png`) make the Pieces panel the most pleasant panel in the app.

**What needs tuning.**

- **Selected rows in dark are bronze.** The system doc already says it: a 20% wash of yellow on navy cancels to a muddy brown. Selected outline rows, the selected project row and the pressed Pivot segment all sit on that bronze (`43-outline-group.png`, `61c-project-status-badges.png`, `30-placed-piece-inspector.png`). Use the accent (teal) or a lighter navy for large washes and keep yellow for lines and dots, as the doc itself recommends.
- **Viewport blues do not match the chrome.** The perspective pane's water is a saturated cerulean and the dark ortho panes are a cold slate (`37-four-panes.png`); against navy panels the viewport looks like a different product. Shift the ground and sky one step toward the stadium navy, and tint the ortho grid plane from the same hue. Same in light: the pane is a bright sky-blue on warm paper (`38-light-theme.png`, `38-light-four-panes.png`); desaturate toward the paper.
- **Primary yellow on non-actions.** The active panel tab's underline, the focused Save button and the Done button are right. The tool-strip active state, the toggle switches in Display and Settings (`90-display-popover.png`) and the Finish select's focus ring all also go yellow, so a full panel of switches reads as a row of warnings. Switches and toggles can take the accent; keep yellow for the one primary action per surface.
- **"Not exported" is blue, "Unsaved" is orange.** Blue reads as information, which is fine, but Not exported is the resting state of every map and in the panel it is the loudest thing on screen (`61-project-panel.png`). Make it a neutral outline chip; keep colour for Unsaved, In sync and Changed.
- **Difficulty bars are the game's RGB (white, green, blue, red)**, which is correct for recognition, but they are the only saturated green and pure red in the UI (`17d-project-settings-workshop.png`). Fine as is; just do not let them become the model for other status colours.
- **The transform X/Y/Z tabs are pure red/green/blue** (`30-placed-piece-inspector.png`). Industry convention, keep them, but their saturation is a step above everything else on the panel; pull them 10% toward the surface.
- **Light theme water and sky** need the same treatment as dark: the sky band at the top of the pane is a flat beige strip with a hard edge against the blue.
- **Top bar in light** is paper-on-paper with no divider under it (`zoom-light-topbar.png` in round 2 framing); add the hairline the dark bar has.
- **Hero band text**: "A map editor for Ballest of Them All." at tertiary grey on the gradient is the lowest-contrast text in the app (`80d-start-screen-zoom.png`). One step up.

**Overreach check.** None. There are no gradients on panels, no textured backgrounds in the editor, no coloured text on coloured surfaces, no decorative chrome. The illustration is confined to two hero bands. If anything the editor could carry one more touch of the palette (a tinted hover on rows, a warmer `--muted`) without crossing the line.

## Per view (deltas only; what round 2 said still holds where not mentioned)

### Top bar (8, T 8)

Logo and name at the left, menus, project name centred with a yellow dirty dot, Play as a yellow button. Clean. The blank 85px left of the logo is gone. Remaining: Recent projects disabled with no tooltip (bug 6).

### Dock (7, T 7)

Four icon tabs, active one labelled with a yellow underline; "…" on each group; closed panels reopen from a dimmed icon (`06b-panel-closed.png`). Bugs 2 and 3 are dock bugs. The document tab tooltip is the shared component with name and status.

### Viewport chrome (8, T 7)

"Panes" and "Display" are labelled with chevrons; World, 10 cm, 15° unchanged; tooltips with KeyChips. The group sits at 80% card over the viewport and reads as chrome. Theme note on the water colour above.

### Inspector: map (7, T 7)

Created Nov 5, 2026 with the relative time in the tooltip; Status "Not validated ⓘ"; File with a reveal icon. Creator is still `spigipplespigipplespigipple` unbroken; truncate with a tooltip. The lighting sliders are yellow, which is one of the places yellow should probably be the accent instead.

### Inspector: item and group (8, T 7)

Paint shows "Base Surface Metal · Smooth" with a swatch row (`30-placed-piece-inspector.png`); Goal shows an "Off-panel" chip instead of the sentence. Group of 2 lists members, "× 2" only when it repeats. Bronze selection wash in the Pivot segmented control (theme).

### Outline (8, T 7)

Unchanged structure; selection wash is the bronze problem. Preferred direction stays: piece rows should carry the piece's thumbnail (round 1 had it; round 2 replaced it with a glyph), glyphs for Player Start, Goal and groups.

### Pieces (8, T 8)

S/M/L tags in the dawn tints, grid outlines matching, three header icons with tooltips (`29e-*`). Sort S/M/L consistently within a family. Tooltip still leads with the class name.

### Prefabs (7, T 7)

"No prefabs yet." centred; Save-as-prefab is one field plus a "Stored in" toggle. The pressed segment ("Project") is nearly indistinguishable from the unpressed (`49-save-prefab-dialog.png`). Bug 4.

### Project panel (7, T 7)

Badges as described. The row tooltip no longer covers the ⋯. Bug 2.

### Status bar (7, T 7)

`◌ Not exported` (blue) and `✎ Unsaved` (orange) as chips; the popover is title plus Export / Play. Bug 7. Still no state after Export (unreachable without Export; by design).

### Settings (8, T 7)

Rows, sliders, info tooltips all hold. Game page has Reveal (open folder glyph) and Choose (folder-search glyph) with tooltips. Bug 5. Toggle switches are yellow (theme note).

### Project settings (8, T 7)

Breadcrumb "Project settings › Harbor Loop › Workshop"; Workshop under the map in the sidebar with the globe glyph and indentation. Difficulty tooltip "Advanced: 3 blue bars in the game". Good.

### Start screen (7, T 8)

Hero band, recent rows with ⋯ (Open in new window / Reveal / Remove from recent), What's new card. Rows show the last-opened time per the manifest; the disabled row keeps its name. Focus-visible only. The lower half of the window is still empty; acceptable now that the block is centred. Bug 9 in light.

### Light theme (7, T 7)

Everything follows the palette; the About hero in light is lovely. Water/sky tuning above; top bar hairline.

## Flows (unchanged from round 2 except)

| Task                                 | R2            | R3                                               |
| ------------------------------------ | ------------- | ------------------------------------------------ |
| Toggle sky / water / lighting / grid | 3 homes       | Display popover only                             |
| Reopen a closed panel                | View › Panels | Click its dimmed icon in the strip               |
| Why is an item disabled              | Some tooltips | Most; Recent projects and Re-import still silent |

## What to do next, by score impact

1. **Shortcuts after Escape** (bug 1). One-line fix in `keyTargets.ts`; it blocks every keyboard user.
2. **Selection wash**: swap the 20% yellow wash for accent or a lighter navy on selected rows, pressed segments and the project row. This is the single biggest theme improvement left.
3. **Viewport colours**: pull the perspective water, the dark ortho slate and the light sky-blue toward the chrome's hue in both themes.
4. **Yellow only for actions**: switches, sliders and focus rings take the accent; Play, primary buttons, active tool and active tab keep yellow.
5. **Untitled project panel** double state, **reopened panel order**, **never-saved chip** (bugs 2, 3, 7).
6. **"Not exported" as a neutral chip**; colour only for Unsaved / In sync / Changed.
7. **Copy**: the MP_PlayerStart tooltip, Recent projects and Re-import reasons, creator truncation.
8. **Stale Keybinds scrollbar**, **prefab thumbnail flash**, **Stored in pressed state**.
9. **Outline thumbnails for pieces** (keep glyphs for specials and groups).
10. **Light New project card** gradient artefact: confirm on a GPU, else flatten the card.

## Not reviewed

Native prompts, Import clash / Overwrite / Replace published, Release notes (external), update pill, popped-out panels, Game link first-run when something is missing, drag-and-drop, splitter dragging, gizmo interaction, the exported and changed-in-game chip states (need Export).
