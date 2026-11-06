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

## What separates 8 from 9, per view

The bar for 9 is a shipping professional tool: the view does its job without the user noticing the view. Each item below is one change, where it shows, and how to verify it. "Fine" at 8 means nothing is wrong; 9 means something is actively good. Items assume the six round-6 next-steps are done.

### Theme (8 → 9)

1. **A hover and pressed language that is the same everywhere.** Today rows, menu items, tabs, chips and icon buttons each brighten by a different amount (+13 on card, +17 on a menu row, icon buttons barely). Define two tokens, `--hover` (surface +10%) and `--pressed` (surface +16%), and apply them to every interactive element, with the 120 ms ease-out. Verify: hover a row in Outline, Project, Pieces, a menu item, a panel tab, a segmented pill and an icon button, screencast a frame of each, and the measured lift is the same number on all seven.
2. **Focus-visible is one ring.** Keyboard focus currently shows as a teal ring on inputs, a lighter wash on rows and nothing on icon buttons. One 2 px accent ring with a 2 px offset on every focusable element, only on `:focus-visible`. Verify: Tab through the top bar, the panel strip, an outline row, the inspector fields and the toolbar; every stop shows the same ring; a mouse click shows none.
3. **The viewport's horizon in dark matches the chrome's black.** After the water fade is fixed, the haze band at the top of the pane should settle into the clear colour `rgb(14,16,19)`, not a warm cream strip (`100-editor-map.png`, top 120 px). Verify: sample the top 20 px of the viewport at x = 900 in dark; it is within 4 points of the clear colour.

### Viewport chrome (8 → 9)

1. **Scale readout in the perspective pane.** Ortho panes show "1 px = 4.7 cm"; the perspective pane shows nothing. Put the camera's height above the grid plane and its distance to the selection in the same corner card ("12.4 m up · 31 m to Goal"). Verify: the card is in `100-editor-map.png` bottom-left and the numbers change when the camera moves.
2. **A view cube or axis gizmo you can click.** The ortho corner card is a static axis drawing. Make it a clickable gizmo: click an axis to snap to that ortho view, click the centre to return to perspective, with a 150 ms camera tween. Verify: click X in the perspective pane's card and the pane becomes Right; click the centre and it returns.
3. **Toolbar off the divider in split layouts.** Reserve a 44 px strip under the panes for the toolbar when more than one pane is open, so it never crosses a pane edge. Verify: in four-pane the toolbar's bounding box does not intersect the vertical splitter at x ≈ 841.

### Inspector: map (8 → 9)

1. **Creator as a chip with an avatar, truncated at 18 characters**, with the full name and "From Steam" in a tooltip. Today it is a 29-character lowercase token in the value column. Verify: `32-inspector-goal.png` right column shows "spigipplespigip…" in a pill with a 16 px avatar glyph.
2. **Status row as a button.** "Not validated ⓘ" explains but does nothing. Make the row a secondary button "Validate" that runs the format checks and turns the row into "Valid · 2 warnings" with a disclosure listing them. Verify: click it on the sample map and the row changes state; the list opens.
3. **Lighting rows preview on hover.** Hovering a lighting slider's track should show a 24 px swatch of the sky colour at that time next to the thumb. Verify: hover Time of day at 50% and a swatch appears above the thumb in the sky's noon colour.

### Inspector: item and group (8 → 9)

1. **Drag-to-scrub on every numeric field.** Location, Rotation and Scale fields should scrub on horizontal drag with Shift for ×10 and Alt for ×0.1, cursor `ew-resize` on hover. Verify: press on the X field and drag 100 px; the value changes by 100 cm (Shift: 1000, Alt: 10) and the piece moves live.
2. **Relative entry.** Typing `+50` or `-20` or `*2` in a field applies the operation to the current value. Verify: X = -2790, type `+100`, Enter; X = -2690.
3. **Group inspector shows bounds and count as a card**, not rows: "2 items · 12.4 × 3.1 × 2.0 m" with a Frame button. Verify: `43b-inspector-group-selected.png` right column has one card under the eyebrow with those three facts and a button.

### Pieces (8 → 9)

1. **Drag to place.** Click places at the camera; drag from a row or tile onto the viewport should place at the hit point under the cursor with a ghost preview following the pointer. Verify: drag Curve 1 M onto the grid at CSS (700, 800); the piece lands where the pointer was released, not at the camera.
2. **Recent and favourites.** A "Recent" category at the top with the last eight placed pieces, and a star on hover that pins to "Favourites". Verify: place three pieces; the Recent section lists them newest first; star one and it appears under Favourites across a relaunch.
3. **Thumbnails that distinguish S/M/L.** Same shape, three sizes, three identical tiles. Render each size at its true relative scale within the tile (S at 60%, M at 80%, L at 100%) so the tiles differ at a glance. Verify: `29d-pieces-size-tags.png` shows Curve 1 S visibly smaller than Curve 1 L inside the same tile size.

### Prefabs (8 → 9)

1. **Thumbnail from the definition's contents.** The prefab row shows one member's thumbnail. Render the definition (all members, framed) to the same 128 px cache as pieces. Verify: the asdf row's thumbnail shows both kickers.
2. **Instance count on the row.** "2 items" is the definition's size; add "· 3 placed" when the open map holds instances, and make it a link that selects them. Verify: place two instances; the row reads "2 items · 2 placed"; click "2 placed" and both are selected.
3. **Save-as-prefab suggests a name** from the selection ("Kicker pair", "Curve 1 Medium × 3") instead of an empty field. Verify: select two Kicker 1 S, Edit › Save selection as prefab…; the field is prefilled and selected.

### Project panel (8 → 9)

1. **Map rows carry a thumbnail.** A 32 px render of the map (top-down, framed to items) cached on save, with a placeholder glyph until the first save. Verify: `61-project-panel.png` rows show a thumbnail left of the name after a save.
2. **Last-edited time under the name** in tertiary: "Edited 3 min ago". Today it is only in the tooltip. Verify: the row is 40 px with two lines and the second line updates after an edit.
3. **Drag a map row onto the tab strip to open it in a new tab**, and middle-click to open without activating. Verify: middle-click asdf while Harbor Loop is active; asdf's tab appears, Harbor Loop stays active.

### Status bar (8 → 9)

1. **Selection summary at the left.** Blender and Unity both show it: "Goal · 1 of 2 selected" or "3 items · 1 group". Verify: select the Goal; the left of the bar reads "Goal"; shift-click Player Start; it reads "2 items".
2. **The chip is one control with four states and one width.** Unsaved, Saved, Not exported and In sync should all be 118 px so the bar does not shift as the state changes. Verify: measure the chip in `zoom-c-status-pills.png`; all three widths are equal.
3. **Progress in the bar.** Export and Play take time; show a determinate bar inside the chip for the duration instead of a toast. Verify: not reachable without Export; confirm by code review that `exportToGame` drives a progress state the chip reads.

### Settings › Game (8 → 9)

1. **Live re-check.** The page checks once on open; add a 5 s watch while the page is open so plugging the plugin folder in shows "Found" without "Check again". Verify: open the page, rename the plugin folder away and back; the row flips without clicking.
2. **Each row's path as a breadcrumb with a copy icon**, not a mono string. Verify: the Maps folder row shows "Steam › compatdata › … › UserSavedMaps" with a copy button whose tooltip says "Copy path".
3. **An install button on the Editor plugin row** when the plugin is missing, with the version it will install. Verify: not reachable here (everything is found); confirm by code review that the row renders "Install 0.1.0" when `pluginState` is `missing`.

### Project settings (8 → 9)

1. **Unsaved-changes indicator on the sidebar item and a Save/Revert pair** instead of Done. Today Done commits silently. Verify: change the difficulty; the Workshop item gets a dot; Revert returns it; Save clears the dot.
2. **Difficulty as a slider with the five bars as ticks**, since it is ordinal. Verify: `17d-project-settings-workshop.png` shows one track with five labelled stops, the selected one filled.
3. **Tag chips grouped with a count** ("Gameplay · 3 of 16") and a Clear link per group. Verify: select three gameplay tags; the group header reads "3 of 16" and Clear removes them.

### Backups (8 → 9)

1. **A preview of the selected backup.** List rows on the left, a 240 px top-down render and "12 items · Nov 5, 10:17 PM · 3.4 KB" on the right. Verify: with one backup present, selecting it shows the preview panel.
2. **Diff against the current map**: "+2 items · −1 item · 3 moved". Verify: edit the map, open Backups, select the latest; the summary line shows the delta.
3. **Restore as a new map** alongside Restore in place. Verify: the row's actions show both; Restore as new opens a tab named "asdf (backup)".

### Keyboard shortcuts (8 → 9)

1. **Search.** A filter field at the top that matches action names and key names. Verify: type "dup"; only Duplicate rows remain across sections.
2. **Rebind from the sheet.** Click a chip to record a new binding inline, same as Settings › Keybinds. Verify: click the Duplicate chip, press Ctrl+J; the chip reads Ctrl + J and Settings › Keybinds agrees.
3. **Platform-aware chips.** Show ⌘ on macOS and Ctrl elsewhere, from one source. Verify: on this Linux machine chips read Ctrl; code review shows the modifier label comes from `platform`.

### Split panes (8 → 9)

1. **Drag a pane's picker onto another pane to swap them**, and double-click a pane's header to maximise it. Verify: double-click "Top"; the Top pane fills the viewport; double-click again restores four.
2. **Per-pane grid and sky toggles in the pane's picker**, so an ortho pane can hide the sky while perspective keeps it. Verify: open the Top pane's picker; it has Show grid and Show sky switches that affect only that pane.
3. **Pane sizes persist per map** with the layout. Verify: resize the splitter, switch tabs and back; the split is kept.

### Prefab definition tab (8 → 9)

1. **A "Used in" row** in the inspector listing the maps that hold instances, each a link that opens the map. Verify: place an instance in asdf; the prefab tab's inspector shows "Used in · asdf" and clicking opens that tab.
2. **Edit-in-context banner on instances**: selecting an instance shows a thin bar over the viewport, "Instance of asdf · Open definition · Detach", so the two actions do not need the inspector. Verify: `77b-prefab-placed.png` shows the bar under the pane picker.
3. **Save from the definition tab updates every instance live**, with a toast "3 instances updated". Verify: edit the definition, Ctrl+S; the instances in the map tab change and the toast appears.

### Light theme (8 → 9)

1. **A true white card level.** Panels `#f3f5f6`, cards `#fcfcfd` and popovers white are two points apart; raise the card step to `#ffffff` and drop the panel to `#eef1f3` so the three levels read as clearly as dark's do. Verify: `zoom-d-three-levels-light.png` shows three distinguishable greys.
2. **Shadows that work on white.** The 20% float shadow vanishes on light; use a 12% shadow with a 1 px `rgb(0,0,0,0.08)` border on light popovers and menus. Verify: `104-editor-menu-open-light.png` menu has a visible edge and a soft shadow.
3. **Dirty dot and accent at 4.5:1** on white. The accent `#007787` passes; the dot does not. Verify: compute the dot's contrast on the panel; ≥ 4.5.

### Display popover (8 → 9)

1. **A second group for the gizmo**: axis gizmo size (S/M/L) and whether it shows for groups. Verify: the popover has a GIZMO eyebrow with a segmented control and a switch.
2. **Grid colour inline**, not a link to Settings. Two swatches with a reset. Verify: the popover shows the two grid colours with the same control as Settings › Appearance and the link is gone.
3. **Reset to defaults** in the popover footer. Verify: toggle everything off, click Reset; all four switches are on and grid height returns to the player start.

### About dialog (8 → 9)

1. **Build info with Copy**: version, commit, build date, Electron and Chromium versions, in a mono block. "Copy" copies the block. Verify: the dialog shows five lines under Version; Copy puts them on the clipboard.
2. **Check for updates in the dialog** with the result inline ("Up to date · checked 2 min ago"), instead of only in Help. Verify: a button under the version; clicking it shows a state line.
3. **Credits and licences link** that opens the third-party notices. Verify: a "Open-source licences" link next to LICENSE that opens a scrollable list.
