# UI critique, round 4

Reviewer: Robin Ebers (role-played). Build: `feat/ui-redesign` at `95547f9fb`, desktop app, 1723×1078 CSS px window. Screenshots: `/home/spigelli/.cache/ballest-editor/ui-critique-round-4/shots/` (409 files from four parallel agents; every surface in dark and light, `-light` twins; the twelve full-window pairs the theme was judged from are `100-editor-map` through `111-editor-prefab-tab`; `MANIFEST-A..D.md` have menu dumps, badge colours and bug checks). Earlier rounds: `ui-critique-round-1.md` to `ui-critique-round-3.md`. System: `ui-system.md`, rewritten to the twelve rules.

Same scale as before. Theme is scored by rule 12: full-window shots at 100%, dark then light, first impression. Per-view theme sub-score in the T column.

## Scoreboard

| View                                    | R1 | R2 | R3 | R4    | T     | One line                                                                                                                                                                                                      |
| --------------------------------------- | -- | -- | -- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall                                 | 4  | 6  | 5  | **7** | 7     | This is the first round where the app looks like a product I would ship. Dark is clean and modern; light is nearly there with three concrete faults; the structure underneath has held since round 2.         |
| Theme                                   | –  | –  | 2  | –     | **7** | Dark 8, light 6. Neutral charcoal, one teal accent, pills and tone separation: the philosophy landed. Light is let down by black piece thumbnails, a heavy grid and flat water. Glass popovers smear in both. |
| Top bar and menu bar                    | 5  | 7  | 8  | 8     | 8     | Quiet charcoal strip, teal Play. The 84px blank left of the logo is still there.                                                                                                                              |
| Dock                                    | 4  | 6  | 7  | 8     | 8     | Panels return to their slot; Untitled panel shows one state; tabs are tone-separated.                                                                                                                         |
| Viewport chrome                         | 5  | 7  | 8  | 8     | 8     | Glass pill groups, labelled Panes and Display, toolbar as a pill with a teal active circle. Toolbar straddles a pane border in four-pane.                                                                     |
| Inspector: map                          | 4  | 6  | 7  | 8     | 8     | Teal sliders, tone-separated rows. Creator tooltip repeats an untruncated name.                                                                                                                               |
| Inspector: item and group               | 3  | 7  | 8  | 8     | 7     | Pivot is one track with a sliding pill, swatches are circles. X/Y/Z tabs are still the loudest colour on the panel.                                                                                           |
| Outline                                 | 5  | 7  | 8  | 9     | 8     | Thumbnails for pieces, glyphs for specials and groups, teal selection wash. Done.                                                                                                                             |
| Pieces                                  | 4  | 7  | 8  | 8     | 6     | Pills for S/M/L, tone-separated grid. In light the thumbnails are black tiles on white.                                                                                                                       |
| Prefabs                                 | 4  | 6  | 7  | 8     | 7     | Empty state centred, Stored in pressed state clear. Light prefab blends into the water.                                                                                                                       |
| Project panel                           | 4  | 6  | 7  | 8     | 8     | Amber Unsaved, neutral Not exported. Right.                                                                                                                                                                   |
| Status bar, sync, notifications, toasts | 5  | 6  | 7  | 7     | 6     | Never-saved map gets the chip. Glass popovers show the viewport through them as a smudge; notifications has a tone seam through its title.                                                                    |
| Menus (content)                         | 5  | 7  | 8  | 8     | 8     | Glass, 10px radius, KeyChips as pills.                                                                                                                                                                        |
| Settings › Game                         | 3  | 7  | 8  | 8     | 8     | Fine.                                                                                                                                                                                                         |
| Settings dialog                         | 5  | 7  | 8  | 8     | 8     | Rows grouped in one raised card, teal switches, scrollbar bug gone.                                                                                                                                           |
| Project settings                        | 4  | 6  | 8  | 8     | 8     | Tag chips are pills, difficulty keeps the game's bars. Breadcrumb mixes two separators.                                                                                                                       |
| Save, Rename, Duplicate, New project    | 3  | 8  | 8  | 8     | 8     | Text selection is browser blue, not the accent.                                                                                                                                                               |
| Backups                                 | 3  | 7  | 8  | 8     | 8     | Segmented control is one track.                                                                                                                                                                               |
| Start screen, Where to open             | 4  | 6  | 7  | 8     | 8     | Neutral card, teal line drawing, white ball in dark and black in light. The ball should be the accent, not foreground.                                                                                        |
| Keyboard shortcuts                      | 6  | 7  | 8  | 8     | 8     | Fine.                                                                                                                                                                                                         |
| Split panes                             | 5  | 6  | 7  | 7     | 6     | Dark ortho panes are now neutral and match. Light four-pane is still blue over grey.                                                                                                                          |
| Prefab definition tab                   | 4  | 7  | 8  | 8     | 7     | Fine.                                                                                                                                                                                                         |
| Light theme                             | 2  | 6  | 7  | 6     | 6     | Chrome is right. Thumbnails, grid and water are wrong.                                                                                                                                                        |
| Display popover                         | –  | 5  | 7  | 8     | 7     | Owns the toggles; shows the Goal ring through its glass.                                                                                                                                                      |
| About dialog                            | –  | 4  | 8  | 8     | 8     | Fine.                                                                                                                                                                                                         |

## What got fixed (verified)

- **The theme reset.** Surfaces are `#141618` → `#1c1f23` → `#24282c` with no nameable hue (`100-editor-map.png`); light is `#f3f5f6` → white. One teal accent on Play, the active tab underline, the active tool, selection, focus and primary buttons; yellow survives only as the dirty dot. Borders are alpha hairlines; Settings rows sit in one raised card with tone dividers; the Workshop page has no outlined rectangles; chips, tags, badges, KeyChips and the status chip are pills; Pivot, Flip, Stored in, Backups and Difficulty are one track with a sliding pill (`30d-pivot-segmented.png`, `zoom-segmented.png`); primary buttons have the inset highlight and tinted shadow (`zoom-button-pair.png`); menus, popovers and the viewport groups are glass with a 10px radius (`zoom-dark-menu.png`, `zoom-dark-viewctl.png`); the font is the system stack.
- **Sky off draws no dome.** `110-editor-sky-off.png` is a flat neutral backdrop with the grid fading by distance and no horizon band. Verified in both themes.
- **Shortcuts after Escape.** Ctrl+D after Edit › Escape duplicated the Goal in both themes (`93-shortcut-after-escape`).
- Panels return to their slot; the Untitled panel shows either unsaved rows or the empty state; "Player Start can't go in a prefab"; the Keybinds scrollbar no longer persists; Recent projects and Re-import show their reasons; a never-saved map gets the Unsaved chip with Save in its popover; thumbnails show a glyph until loaded; the New project card is flat; S/M/L sort consistently; the hidden tab-menu button is gone; creator truncates with a tooltip (though at this width it does not need to).
- **Outline piece rows show thumbnails** with glyphs for Player Start, Goal and groups (`31b-outline-thumbnails.png`). This is the direction the owner asked for in round 2 and it reads well.

## Theme, judged from the full-window pairs

**Dark (8).** `100-editor-map.png`: charcoal panels, a hairline between them, one teal Play button, a teal underline on the active tab, a glass pill group over the viewport, a pill toolbar with one teal circle. The eye goes to the scene. `101-editor-item.png`: the inspector is a column of quiet rows with one pressed pill in the Pivot track and a row of circular swatches. `104-editor-menu-open.png`: the menu floats on glass with pill shortcuts. `105-editor-settings.png`: rows in one raised card, teal switch, teal Done. `80-start-screen.png`: a neutral card with a teal line drawing. Nothing in the chrome is nameable as a colour. This is sleek and modern, and it has the pop the owner asked for in the right places: the teal circle on the active tool, the amber Unsaved pill, the slide of the segmented pill.

Three small things keep dark from 9: the X/Y/Z tabs on the transform fields are the game's pure red, green and blue and are now the most saturated thing on the inspector (`101-editor-item.png`); the swatch row has the same problem by design and that is fine; and the ball in the hero drawing is white foreground rather than the accent, so the one illustration has two colours.

**Light (6).** The chrome is right: `#f3f5f6` panels, white cards, teal accent, the same hierarchy (`100-editor-map-light.png`, `105-editor-settings-light.png`, `80-start-screen-light.png`). The viewport is not:

- **Piece thumbnails are black tiles.** The PNGs have a dark background baked in, so the Pieces list and grid in light are columns of black rectangles on a white panel (`102-editor-pieces-grid-light.png`, `06-panel-PIECES-light.png`). This is the single worst thing in the light theme and it is on screen whenever the Pieces tab is open. Render the thumbnails with a transparent background, or with a per-theme background, or composite them over the tile's own tone.
- **The grid is near-black on pale blue.** In light, the 10 m lines at `#4b4c4d` are the loudest element on screen and the 1 m lines moire at the horizon (`100-editor-map-light.png`, `110-editor-sky-off-light.png`). Lift both two steps toward the water colour; the dark theme's grid is the right weight.
- **The water is one flat blue** with no fade, and in four-pane the top row is that blue while the bottom row is pale grey, so the window reads as two apps (`103-editor-four-panes-light.png`). Tint the light ortho panes toward the water as was done for dark, and give the light water the same distance fade as dark.
- The prefab's pale teal side faces disappear into the water in light (`111-editor-prefab-tab-light.png`). Scene colours are the game's and should stay, but the editor's water can be a step darker in light to keep the pieces readable.

**Both themes.**

- **Glass popovers smear.** The sync popover shows the toolbar through it as a blur, the Display popover shows the Goal ring through it, and the notifications popover has a hard tone change through its title where the panel edge sits behind it (`107-editor-popover.png`, `108-editor-display.png`, `82-notifications-one.png`). Glass works over flat chrome and fails over a 3D scene. Raise the popover opacity to 92 to 95% when it overlaps the viewport, or drop the blur for popovers anchored inside the viewport and keep it for menus over chrome.
- **Text selection is browser blue**, not the accent (`106-editor-dialog.png`). Set `::selection` to the accent at 30%.
- **The toolbar pill straddles the active pane's border** in four-pane (`103-editor-four-panes.png`). Pin it to the viewport's bottom edge, under all panes, like the top-right group.

**Geometry.** "Blocky" is fixed. Controls are 8px, surfaces 10px, every small thing is a pill, borders are felt not seen. The inspector no longer reads as boxes in boxes (`101-editor-item.png`), the Workshop page is chips on one card (`17d-project-settings-workshop.png`), the viewport controls are two glass pills (`zoom-dark-viewctl.png`).

**Overreach check.** None. The game appears in the viewport and in one line drawing. The chrome quotes nothing.

## Bugs found this round

1. **Light piece thumbnails have a baked-in dark background** (theme, above). Not a regression; the neutral light panel exposed it.
2. **Glass popovers over the viewport show the scene through them** (theme, above).
3. **Start screen window title** reads "• Untitled Project – Ballest Editor" with no project open; the dirty dot and the project name are both wrong there.
4. **Closing the last tab leaves an Untitled tab marked Unsaved**, and opening a saved map then replaces it with no prompt. An untouched map should not be dirty.
5. **Opening the bell does not clear the unread badge**; Mark all read is needed.
6. **Workshop breadcrumb** mixes "›" and "→" style separators ("Project settings › Harbor Loop › Workshop" with uneven spacing).
7. **Tooltip on an untruncated creator** repeats the name and hides the label.
8. **Base Spline Actor tooltip** shows a raw extractor note ("no StaticMeshComponent with a mesh…").
9. **Pieces scrollbar thumb** stays visible on an empty search result; **Hidden** has duplicate row names (seven "Boolean Arena White").
10. **Placed pieces stack on the same spot** (since round 3).
11. **Windows opened on Outline rather than Project** as the default left panel (both C windows); check the default layout.
12. Intermittent, no repro: a Ctrl+S 400 ms after Escape closed Save map did nothing twice; a Ctrl+D 700 ms after Escape did nothing once while the menu was still animating. If the menu close animation holds focus for its duration, shorten it or hand focus back on close start.
13. The 84 CSS px blank left of the logo in the top bar is still there.

## Per view (deltas only)

### Top bar (8, T 8)

Charcoal, hairline below, teal Play pill. The project name is centred in secondary grey with the dirty dot in yellow. Bug 13.

### Dock (8, T 8)

Panel tabs are icon-only with the active one labelled and underlined in teal; the document strip is one tone lighter. Closed panels come back to their slot. Nothing to add.

### Viewport chrome (8, T 8)

Two glass pill groups top-right, a glass picker top-left, a pill toolbar bottom-centre with a teal active circle. Units on values, labels on Panes and Display. The toolbar's pane-border overlap in four-pane is the only fault.

### Inspector: map (8, T 8)

Rows separated by tone, teal sliders with a mono value field. Bug 7.

### Inspector: item (8, T 7)

Category eyebrow, friendly title, pill "Off-panel" chip, circular swatches, Pivot as one track. The X/Y/Z tabs at full saturation are the one thing I would pull back 15%.

### Outline (9, T 8)

Thumbnails for pieces, glyphs for specials and groups, teal selection wash at 12%. This is what round 1 asked for and round 2 misread.

### Pieces (8, T 6)

S/M/L pills in dawn tints, grid tiles tone-separated. Bug 1 in light. The Hidden category's duplicates and the extractor-note tooltip are catalogue problems, not UI ones, but they show in the UI.

### Prefabs (8, T 7)

"No prefabs yet." centred, Game section with a thumbnail row. Light prefab readability (theme).

### Project panel (8, T 8)

Amber "Unsaved" pill, neutral "Not exported" pill, teal selection wash on the open row. Correct.

### Status bar (7, T 6)

Chip is a pill; never-saved maps get it. The popover is glass over the viewport (bug 2). After a save the chip stays "Not exported" with nothing confirming the save once the toast is gone; a 2 s "Saved" state on the chip would close that gap.

### Settings (8, T 8)

One raised card per page, teal switches and selects, Done in teal. Scroll bug gone.

### Project settings (8, T 8)

Workshop nested, chips as pills, difficulty with the game's bars and tooltips. Bug 6.

### Start screen (8, T 8)

Neutral card, teal line drawing, recent rows with ⋯, What's new card. Make the ball the accent colour in both themes; it is the one place the illustration should pop. Bug 3.

### Split panes (7, T 6)

Dark: neutral ortho panes that match the chrome. Light: blue over grey (theme).

### Light theme (6, T 6)

Chrome right, viewport wrong in three ways (theme section).

## What to do next, by score impact

1. **Light viewport**: thumbnails with no baked background, grid two steps lighter, water with a distance fade and ortho panes tinted to match. This takes light from 6 to 8 and the Theme row to 8.
2. **Popover glass over the viewport**: opacity 92 to 95% or no blur when anchored in the viewport; fix the notifications tone seam.
3. **Accent on `::selection`**, the hero ball, and the X/Y/Z tabs pulled back 15%.
4. **Toolbar pinned under all panes** in split layouts.
5. **Untouched map is not dirty** (bug 4), start-screen window title (bug 3), bell badge clears on open (bug 5).
6. **Menu close hands focus back at close start**, not after the animation (bug 12).
7. **Saved state on the chip** for 2 s after a save.
8. **Copy and catalogue**: breadcrumb separators, creator tooltip, the extractor note, Hidden duplicates, empty-search scrollbar.
9. **Default left panel** on open (Project, not Outline), and the blank 84px left of the logo.
10. **Stacked placement**: offset each placed piece from the last.

## Not reviewed

Native prompts, Import clash / Overwrite / Replace published, Release notes (external), update pill, popped-out panels, Game link first-run when something is missing, drag-and-drop, splitter dragging, gizmo interaction, exported and changed-in-game chip states.
