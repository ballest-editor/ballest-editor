# UI critique, round 2

Reviewer: Robin Ebers (role-played). Build: `feat/ui-redesign` at `8caa85a5e`, desktop app, dark theme unless noted, 1723×1078 CSS px window. Screenshots are in `/home/spigelli/.cache/ballest-editor/ui-critique-round-2/shots/` (same names as round 1 where the view matches, plus new surfaces; four manifests `MANIFEST-A..D.md` list every shot and every menu dump). Round 1 is `ui-critique-round-1.md`; the system the team adopted is `ui-system.md`.

Same scale as round 1: out of 10 against a shipping professional tool. Deltas are against the round 1 scoreboard.

## Scoreboard

| View                                            | R1 | R2    | One line                                                                                                                   |
| ----------------------------------------------- | -- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| Overall                                         | 4  | **6** | The system landed and it shows. What is left is behaviour, copy and a handful of real bugs, not a missing design language. |
| Top bar and menu bar                            | 5  | 7     | One strip, one type role, Play is a button, Help exists. Blank 85px left of the title.                                     |
| Dock: panel strip, document tabs, group menus   | 4  | 6     | Fits four tabs with icons; sash draws over menus and hover-widen closes tabs.                                              |
| Viewport chrome                                 | 5  | 7     | One shape, units, tooltips with keys. Pane picker stays open; Display is an unlabeled eye.                                 |
| Inspector: map                                  | 4  | 6     | Inline slider rows and a clock. "Created 4 h ago" on a map made a minute ago.                                              |
| Inspector: item and group                       | 3  | 7     | Friendly title, X/Y/Z, units, Details, swatches, group summary. Finish select has no state.                                |
| Outline                                         | 5  | 7     | One glyph system, breadcrumb, full context menu.                                                                           |
| Pieces                                          | 4  | 7     | Real names, S/M/L, grid view. Tooltip still leads with the class.                                                          |
| Prefabs                                         | 4  | 6     | Project and Game, Place vs Open definition. Empty state is still a sentence with a button in it.                           |
| Project panel                                   | 4  | 6     | Text badges and tooltips. Dirty and clean maps carry the same badge.                                                       |
| Status bar, sync popover, notifications, toasts | 5  | 6     | Chip, one row layout, version gone. Chip ignores unsaved edits.                                                            |
| Menus (content)                                 | 5  | 7     | One KeyChip, reasons on disabled items, View split into groups.                                                            |
| Game link (now Settings › Game)                 | 3  | 7     | A status page with Found rows. Two unlabeled folder icons per row.                                                         |
| Settings dialog                                 | 5  | 7     | One-line rows with info tooltips, real sliders. Search footer and "this browser" copy slipped.                             |
| Project settings                                | 4  | 6     | Map and Workshop split, difficulty labelled. Workshop sits under MAPS as if it were a map.                                 |
| Save, Rename, Duplicate, New project            | 3  | 8     | One field, inline validation, a breadcrumb instead of a path.                                                              |
| Recover (Backups)                               | 3  | 7     | List first, segmented control. Title and menu item disagree on the name.                                                   |
| Start screen, Where to open                     | 4  | 6     | A full-window start screen. It uses 10% of the window and its subtitle says "projects".                                    |
| Keyboard shortcuts (cheat sheet)                | 6  | 7     | In Help, stays open. Says Translate where the toolbar says Move.                                                           |
| Split panes                                     | 5  | 6     | Scale chip per ortho pane. Controls still live in one pane; no splitter affordance.                                        |
| Prefab definition tab                           | 4  | 7     | "Stored in Game", readable tab badge, instance inspector explains itself.                                                  |
| Light theme                                     | 2  | 6     | Chrome follows the theme, sky is a gradient. Grid and panel edges are too faint.                                           |
| New: Display popover                            | –  | 5     | Three switches behind an eye icon that reads as "hide". Duplicates Settings › Appearance.                                  |
| New: About dialog                               | –  | 4     | Three lines of text. No logo, no links, no licence.                                                                        |

## What got fixed (and I checked)

- **Type and greys.** 13px body, 11px captions, 15px titles everywhere I looked; eyebrows are one style; disabled menu items are now visibly dimmer than shortcut hints (`04c-menu-Edit.png`). Round 1's biggest complaint is gone.
- **Radii and shapes.** Viewport chrome is one family of 28px rounded rects (`zoom-viewctl.png`); dialogs and menus share one surface radius.
- **Developer vocabulary.** The game filename is gone from the inspector, the dialogs and the status popover; the item title is "Curve 1 Medium" with "RAMPS" as the eyebrow; class, asset, mesh and material live behind DETAILS (`30b-inspector-details.png`); paths became breadcrumbs with the full path in a tooltip (`22-save-map-untitled-project.png`).
- **Dialogs.** Save, Rename and Duplicate are title, one field, two buttons (`65-rename-dialog.png`, `71-save-map-named-project.png`); a bad name shows a red border and one line (`71b-save-map-validation.png`). New project has a breadcrumb. Recover lists first (`67-recover-dialog.png`).
- **Inspector.** Slider, field and unit on one 28px row; time of day is `07:18`; X/Y/Z letters with units in the row label; Pivot is a segmented control; Paint shows a swatch and a name; group selection summarises instead of nesting (`43b-inspector-group-selected.png`); prefab instances say "It follows its definition" with Update / Detach / Open definition (`77b-prefab-placed.png`).
- **Shell.** Help menu with Keyboard shortcuts, Release notes, About; Play is a filled button; one KeyChip rendering in menus, settings and the cheat sheet; disabled items carry a reason tooltip ("Nothing to undo."); the tab context menu has Split right and Split down.
- **Panels.** Four icon tabs fit at 272px; the group "…" is Pop out / Collapse / Close panel / Reset layout only; pieces have names, S/M/L tags, a grid view and a search icon; the outline has one glyph set, F2 rename, Enter group, Select all in group and a breadcrumb plus a status-bar chip while inside a group (`45-entered-group.png`).
- **First run.** No Game link wall; Settings › Game is a status page. The chooser modal is a start screen with a logo, recent rows and a row menu (`80-start-screen.png`). Where to open only asks with unsaved changes and says why (`69-where-to-open.png`).
- **Light theme.** Pane pickers, controls, toolbar, menus and dialogs all follow the theme (`38-light-theme.png`, `38-light-four-panes.png`).

## Bugs the pass turned up (fix before polish; three agents hit the first one independently)

1. **Dock sashes draw over menus.** The 4px `.dv-sash` strips at x≈258–262 and x≈1421–1425 have z-index 99; menus are 50. A click on that strip inside a File or Edit menu row closes the menu and does nothing. Four out of four clicks on File › New map at the item's centre failed. Users hit this exactly where the File menu's text sits.
2. **"Created" is wrong.** A map made seconds ago says "Created 4 h ago", then 5 h, then 7 h in later shots (`03-untitled-project.png`, `70-new-map-tab.png`). Looks like a UTC/local mix-up on the machine's UTC-5 clock. A wrong fact in the inspector is worse than no fact.
3. **Hovering a panel tab widens it** to show the close X, which shifts the tabs under the pointer. One agent closed Pieces by clicking it right after Project. Reserve the space or show the X over the icon.
4. **The sync chip ignores unsaved edits.** A dirty map and a clean one both read "Not exported" (`73b-status-states-*.png`), and the Project panel shows the same badge with only a dot to tell them apart (`61c-project-status-badges.png`).
5. **The pane picker stays open** after choosing a layout (radio items), and after Escape the "Panes" tooltip shows with no hover because focus returns to the button.
6. **A stray "More actions" tooltip** stays up after the prefab row menu closes (`77-prefab-tab.png`).
7. **Settings search** keeps "Reset general to defaults" in the footer while showing Appearance results (`20b-settings-search.png`), and some rows say settings are "kept in this browser" in a desktop app.
8. **Theme is not in View any more, but Show grid is.** Show grid, Show sky, Show water and Map lighting now live in three places: View › Grid, the Display popover and Settings › Appearance › Viewport.

## Per view

### Top bar and menu bar (7)

`zoom-topbar.png`, `04-menu-File.png`, `04c-menu-View.png`, `04c-menu-Help.png`, `46-play-tooltip.png`.

- Good: one text role across the strip, the project name centred with a dirty dot, Play as a filled button with "Export and race it in the game · F5" on hover, Help menu, "Open game (Steam)" instead of "Launch game".
- The strip has ~85px of nothing left of the product name on the editor, while the start screen shows a logo there. Put the logo in both or neither.
- View is now CAMERA / PANELS / PANES / GRID with eyebrows inside the menu. That reads well. "Reset layout" under PANELS is right. "Snap to grid" and "Grid size" are also in the viewport pill; fine as a mirror, but GRID should then also hold Show grid's siblings or none (see bug 8).
- Project still interleaves actions and a checkbox: Export to game, Re-import (disabled, no reason tooltip on it), Play, Open game, then "Export on save", then Project settings. Move "Export on save" into Project settings only, or give it a checkmark column so it reads as a toggle.
- File › Recent projects › "Open in new window ›" is a sub-submenu with one item. Put "Open in new window" as a modifier (Shift-click) or a second column, not a third level.

### Dock (6)

`zoom-tabs.png`, `13-panels-layout-menu-0.png`, `08-tab-context.png`.

- Four tabs fit, with the active one showing icon plus label and the others icon only. That is the right trade. The active label and the document tab label are the same 13px, and the two strips are still the same height family; a 2px underline is the only thing that says "active panel". Acceptable.
- Bugs 1 and 3 above are dock problems and they are the reason this is a 6, not a 7.
- "Close panel" in the group menu has no symmetric "reopen" nearer than View › Panels. A closed panel's icon could stay in the strip, dimmed.
- The document tab's native `title` is the file path; it is not a tooltip in the app's style (`46-tab-tooltip.png` shows nothing). Use the same tooltip component as everything else and show the friendly name plus status.

### Viewport chrome (7)

`zoom-viewctl.png`, `09-perspective-dropdown.png`, `15-view-panes-menu.png`, `19-tooltip-*.png`, `12-toolbar-tooltip.png`, `90-display-popover.png`.

- One shape, 28px, "World" as a word, "10 cm" and "15°" with units, pickers with icons and a check on the current item, tooltips with KeyChips ("Rotate · E"). This is what round 1 asked for.
- The Display control is an eye icon. An eye means "visibility of the selected thing" in every 3D tool; here it opens a popover of Map lighting / Show sky / Show water. Use a "display" or "sun" glyph with a chevron, or label it like the panes button.
- The panes button is an empty square with a chevron and no label; the World button has a label. Make the two leftmost controls match: either both icon plus chevron or both icon plus word.
- The toolbar at the bottom is four 28px squares with the active one filled blue. Fine. It has no labels and no visible shortcuts until hover; a professional tool shows Q W E R in the tooltip, which it now does. Good enough.
- The bugs: picker stays open; focus tooltip after Escape.

### Inspector: map (6)

`03-untitled-project.png`, `60-named-project.png`.

- Rows are tidy, the File row shows "asdf" with a reveal icon, "Not saved yet" is tertiary grey, the lighting rows are one line each with a mono field and a unit. The time-of-day clock is right.
- "Created 4 h ago" is wrong (bug 2). Also, relative time alone is a poor fit for a creation date; show the absolute date and keep relative for "edited".
- "Status ◌ Not validated" replaced "Validated no" with the same mystery. Either explain it in a tooltip (what validates a map, how to do it) or drop the row until the app can validate.
- Creator still shows the raw Steam name as a value row with no way to change it here. That is correct per the round 1 ask, but the name is 29 characters of lowercase and reads as a bug. Truncate with a tooltip.
- The Name field is still the only live-edit rename; Rename… in the panel is a dialog. Pick one; I would keep the field and make the dialog a thin wrapper that focuses it.

### Inspector: item and group (7)

`30-placed-piece-inspector.png`, `30b-inspector-details.png`, `30c-inspector-paint-swatches.png`, `32-inspector-goal.png`, `41-inspector-multi.png`, `43b-inspector-group-selected.png`, `zoom-transform.png`, `48-transform-popover.png`.

- Big step up. Category eyebrow, friendly title, Duplicate and Delete as icon buttons in the eyebrow row, Tags, TRANSFORM with "Location cm / Rotation ° / Scale ×" and coloured X/Y/Z tabs on the fields, Flip as two small X Y buttons, PIVOT segmented, PAINT with swatch and name, PROPERTIES, DETAILS folded.
- Finish is a select that shows the placeholder "Finish" when nothing is chosen, and "Smooth" once chosen, with a swatch row appearing only after a finish is picked (`30c-inspector-paint-swatches.png`). A paint slot should always show its current finish and its swatches; "Finish" as placeholder text looks like a label that lost its value.
- "Not in the game's paint panel ⓘ" on the Goal is a sentence in the section body. Make it a small badge on the slot row.
- Multi-select lists "Curve 1 Medium × 1 / Player Start × 1" and a disabled chip "Player start (required)". "× 1" counts on single items are noise; only show counts above 1. The chip's purpose is unclear (why is it there, why disabled).
- The copy/paste popover on each transform row is now a clipboard icon at the right, which is discoverable. Good.
- Group summary "GROUP OF 2 ITEMS / Name / Tags / members / EDIT ALL 2 ITEMS" is exactly right.

### Outline (7)

`43-outline-group.png`, `44-outline-context.png`, `45-entered-group.png`, `45b-outline-rename.png`, `47-outline-collapsed.png`.

- One glyph set (pin for start, target for goal, ramp glyph for pieces, folder for groups), 24px rows, selected rows in the accent tint, a "Root › Group" breadcrumb inside the panel and an "In group Group ×" chip in the status bar when entered. Context menu covers Group/Ungroup, Enter group, Select all in group, Rename F2, Duplicate, Delete, Focus, Edit tags.
- The pink group frame in the viewport is a thin dashed box that will vanish on busy maps; that is a render question, not a UI one, but note it.
- The outline filter is "Filter" now. Good.

### Pieces (7)

`06-panel-PIECES.png`, `29b-pieces-grid.png`, `29-piece-hover.png`, `29c-placement-flash.png`.

- "Curve 1 · S/M/L", "Bevel Corner Hump Shallow", grid view with 64px thumbnails and the size tag in the corner, a selected-row flash on click (`29c`). The S/M/L tag is only on pieces that come in sizes, which is right.
- The tooltip still leads with the class, "BP_Ramp_Curve1 / Ramps" (`29-piece-hover.png`). Lead with the friendly name and size, put the class last in tertiary grey.
- Grid names truncate at two lines ("Bevel Corner Hump…"). Allow three lines or shorten the Bevel family names ("Corner Hump Shallow" under a "Bevel" category header).
- The three header icons (list, grid, collapse all) have no labels and I could not confirm tooltips on them. Confirm they have them.
- Thumbnails are still one teal material from one angle. With names fixed this matters less, but a size-tinted outline would make S/M/L scannable in the grid.

### Prefabs (6)

`06-panel-PREFABS.png`, `76-prefabs-named.png`, `18-prefab-more-menu.png`, `77-prefab-tab.png`, `49-save-prefab-dialog.png`, `49b-prefab-validation.png`.

- PROJECT / GAME sections, "Place in map" and "Open definition" as the first two menu items, "2 items" right-aligned, tab badge "Game" readable.
- Empty state in Untitled: "No project yet. [Name it…]" is a sentence with a button spliced in. Use a proper empty state: one line, one button underneath.
- "Save selection as prefab" dialog has a two-sentence description, a Name field with "1 to 64 letters, digits, _ and -" as permanent helper text, and a "Stored in" segmented control. Same note as round 1: rules belong in validation, not helper text. The description can go; the segmented labels "Project / Game" with one short tooltip each say it.
- Validation for too few items is a tooltip on the disabled menu item (`49b`), which is correct. The dialog still opened for a two-item prefab instance selection; fine.

### Project panel (6)

`61-project-panel.png`, `61c-project-status-badges.png`, `63-project-row-hover.png`, `64-project-row-menu.png`, `83-project-tip-*.png`, `06-panel-PROJECT.png`.

- Project name bold, three icon buttons with tooltips (New map, Import map, Project settings), rows with a text badge "Not exported", a row tooltip with "Unsaved edits · Edited 6 min ago", a row menu Rename… / Duplicate… / Backups… / Export to game / Play / Reveal in folder.
- The badge reads "Not exported" for both a dirty and a clean map; the only difference is a dot after the name (`61c`). The dot says "unsaved", the badge says "export state", and they are two different axes shown in two visual languages 20px apart. Fold them: "Unsaved", "Not exported", "Exported", "Changed since export" as one badge.
- The row tooltip opens over the badge and the ⋮ button (`63`), so the menu button is hidden by its own row's tooltip. Anchor it below the row or delay it.
- Untitled empty state: an "Untitled" chip in the header, then "Saving a map creates the project." then a "New map" button. The chip is a nice touch; the sentence is still a sentence.

### Status bar, sync popover, notifications, toasts (6)

`zoom-status.png`, `73-status-click.png`, `73-status-click-edited.png`, `16-notifications.png`, `82-notifications-one.png`, `71-toast.png`.

- The chip is a 24px pill with an icon and "Not exported", centred; the popover is title plus Export / Play. The version string is gone. Notifications and toasts share a row layout with time and an action icon.
- Bug 4: the chip has one state for everything short of exported. The round 1 ask was a coloured chip with the three states; only the shape landed.
- Notifications empty state is a title plus a sentence ("Changes made in the game and problems with the game link land here."). One line is enough.
- The "Mark all read / Clear" text buttons sit in the popover header at tertiary grey and look disabled when there is nothing to clear (`16`). Hide them when the list is empty.

### Menus, content (7)

- KeyChips everywhere, disabled reasons, the Help menu, Recent projects populated. "Export on save" without a check column is the one wrong note (see top bar).

### Game link, now Settings › Game (7)

`20-settings-Game.png`.

- Five rows with a green check and "Found", the creator name with a pencil, "Check again" in the footer. This is what round 1 asked for.
- Each row has two unlabeled folder icons at the right; I could not tell "reveal" from "choose" without a tooltip. Add tooltips and consider one icon with a menu.

### Settings dialog (7)

`20-settings-General.png`, `20-settings-Camera.png`, `20-settings-Keybinds.png`, `20-settings-Appearance.png`, `20b-settings-search.png`, `zoom-settings-row.png`.

- One-line rows with an ⓘ for the long explanation, 160px sliders with a mono field and unit, Lighting merged into Appearance under a VIEWPORT eyebrow, grid colours as swatch plus hex, search with per-page counts and a breadcrumb.
- Bug 7 (search footer, "this browser" copy).
- General still has "Version · Ballest Editor 0.1.0. Updates only run in an installed build. [Check for updates]" as a row. Help › About now owns the version and Help › Check for updates owns the action. Drop the row.
- "Fly only while looking · All movement keys" is a label-value pair where the value does not answer the label. Rephrase as "Movement keys need the look button: None / Only the fly keys / All".
- Keybinds: "LEVEL EDITOR" (we call it the editor; the in-game one is the "in-game editor"), "Translate" (toolbar says Move), "Keybind cheat sheet" (menu says Keyboard shortcuts), "MOUSE AND KEYBOARD BINDINGS" as a section between CAMERA and EDITOR CAMERA, "Fly faster · Unbound" with the + inside the chip. Rename the sections to match the cheat sheet (Editor, Edit, Camera, View, File, Game, Help) and the actions to match the toolbar.

### Project settings (6)

`17c-project-settings-general.png`, `17-map-settings-dialog.png`, `17d-project-settings-workshop.png`, `17e-difficulty-hover.png`.

- Map page is Name / File / Grid height / Export on save; Workshop page is Difficulty with labelled, coloured options (Beginner … Baller) and five tag groups with one-line descriptions. General has Name and four LOCATIONS rows with a friendly folder name and reveal icons. All good.
- Workshop appears in the sidebar under MAPS between two map names, with a globe icon, as if it were a map. It is a page of the selected map, so it should be nested under that map or shown as a tab on the map page. With three maps the sidebar will read "Harbor Loop, Workshop, asdf, Workshop, …" or hide the relation entirely.
- "Grid height (cm)" is still a map setting. It is viewport state; round 1 said move it. The "Use player start" button next to it is good where it ends up.
- Difficulty options show no tooltip on hover (`17e`); the colour bars need a legend or a tooltip with what the game calls each.

### Save, Rename, Duplicate, New project (8)

`71-save-map-named-project.png`, `71b-save-map-validation.png`, `22-save-map-untitled-project.png`, `65-rename-dialog.png`, `21-new-project.png`.

- This is the view that moved most. One field, validation on the field, no creator, no filename. The untitled-window Save adds "Project name" and a breadcrumb row with Change…; the full path is a tooltip on the breadcrumb. Right.
- Only note: in `22` the breadcrumb tooltip overlaps the Cancel button when shown. Position it above.

### Recover, now Backups (7)

`67-recover-dialog.png`.

- Segmented "asdf / All backups", list area, Close. The paragraph is gone.
- The menu item is "Backups…" and the dialog title is "Recover a previous version". Make them the same word.
- "No backups yet." as the only content of a 600px dialog is fine, but the dialog should size to its content.

### Start screen and Where to open (6)

`80-start-screen.png`, `80c-start-screen-menus.png`, `81-start-screen-new-project.png`, `38-light-start-screen.png`, `69-where-to-open.png`.

- The modal is gone; the window opens on a start page with the logo, "Recent projects", Open project… and New project, rows with a ⋮ menu (Open in new window / Reveal / Remove from recent), and a "Start a new project" card with a Change… folder button. Where to open now says "This window has unsaved changes. New window leaves them as they are." with New window / Cancel / This window and an "Always do this" switch.
- The start page is a 600px block pinned to the upper third of a 1723px window. Centre it vertically or give the lower two thirds something (last map thumbnails, what's new, the version). A start screen that is 90% black reads as a loading failure.
- Each row says "projects" in tertiary grey after the name. That is the parent folder's name, which for the real user is "Ballest Editor" on every row. Show the last-opened time instead, and the parent folder only when two projects share a name.
- The first row has keyboard focus on load, so it looks hovered at rest ("My first project" is brighter than "my second project" in `80`); one agent read it as the hover state. Style focus-visible only.
- The disabled row ("Open in another window") drops the name to tertiary grey, which also hides the one piece of information you need to click Open in another window. Keep the name at secondary and dim only the hint.
- Where to open: "New window" sits bottom-left away from Cancel / This window. Three buttons, two groups. Fine as a pattern, but "New window" is the safe option here; consider making it the primary.

### Keyboard shortcuts (7)

`23-cheat-sheet.png`.

- In Help, modal, three columns, one CAMERA section. Copy: "Translate" (toolbar: Move), "Keybind cheat sheet" (menu: Keyboard shortcuts), "LEVEL EDITOR" (should be "Editor"), "Orthographic / perspective" for what the pane picker calls Perspective.

### Split panes (6)

`37-four-panes.png`, `38-light-four-panes.png`.

- Each ortho pane has an axis gizmo card with "1 px = 4.7 cm". Good.
- The top-right controls (panes, display, world, grid, angle) sit inside the bottom-right pane in four-pane mode, so they look like they belong to that pane. Pin them to the viewport's corner above the panes, or to the active pane with a visible move.
- No splitter affordance between panes.

### Prefab definition tab (7)

`77-prefab-tab.png`.

- "PREFAB / asdf / Stored in Game / Items 2 / File asdf.json". The tab shows "asdf Game ×" with a prefab glyph. Good. The stray tooltip (bug 6) is in this shot.

### Light theme (6)

`38-light-theme.png`, `38-light-item-inspector.png`, `38-light-four-panes.png`, `38-light-menu.png`, `zoom-light-topbar.png`.

- Everything follows the theme now, including the viewport chrome and the toolbar; the sky is a pale gradient; gizmo colours hold up on the light ground.
- Grid lines on the perspective plane are nearly invisible against the pale blue (`38-light-theme.png`); the 10 m lines need one more step of contrast. Panel borders and the tab strip's bottom edge are also faint.
- The ortho panes are near-white with a light grey grid, while the perspective pane is blue: the four-pane view reads as two different apps (`38-light-four-panes.png`). Tint the ortho background to match.
- Still ship-able only with the grid contrast fixed.

### Display popover (5)

`90-display-popover.png`.

- Three switches in a 180px popover anchored under an eye icon. The content is right (per-viewport display toggles); the trigger is wrong (an eye), and the same three switches exist in View and in Settings › Appearance (bug 8). Keep this popover as the one home, give it a sun-and-cloud glyph with a chevron, and link to Settings for grid colours.

### About dialog (4)

`91-about-dialog.png`.

- Title, one line, "Version 0.1.0". No logo, no link to the releases page or the repo, no licence, no copy button for the version. A 470px dialog with 40px of content.

## Flows

| Task                         | R1                                   | R2                                                                                 |
| ---------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| First launch to an empty map | Game link wall, Done                 | Editor opens (nothing missing); start screen when another window holds the project |
| New map, first save          | Alt+N, Ctrl+S, 3–5 fields            | Ctrl+S, type a name, Enter (untitled window: plus a project name)                  |
| Switch project               | Recent › name, Where to open, prompt | Recent › name; Where to open only with unsaved edits                               |
| Rename a map                 | 4 entry points, 3 UIs                | Still 3 UIs (live field, dialog, settings row); the dialog is now one field        |
| Split the viewport           | View › Panes › Four panes            | Tab › Split right / Split down, or the panes picker                                |
| Find a piece by size         | Scroll                               | S/M/L tags, grid view; no size filter yet                                          |
| See the keybinds             | Hold Shift+/                         | Help › Keyboard shortcuts                                                          |
| Why is Export disabled       | Nothing                              | Tooltip on the item (Undo has one; Re-import from game still has none)             |

## What to do next, by score impact

1. **Fix the sash z-index and the tab hover-widen** (dock, menus). Two reproducible input failures in the most-used strip; they cost more trust than any visual issue in this list.
2. **Make the sync chip and the project badge honest**: one badge with Unsaved / Not exported / Exported / Changed since export, coloured, in the status bar and the panel rows. Then fix "Created N h ago".
3. **One home for display toggles.** Display popover owns Show grid / sky / water / Map lighting; remove them from View and from Settings › Appearance, leaving grid colours in Settings.
4. **Start screen layout.** Centre the block, replace "projects" with last-opened time, style focus-visible, keep disabled row names readable, fill the lower half (recent maps or what's new).
5. **Copy consistency pass.** Move vs Translate, Backups vs Recover, Keyboard shortcuts vs Keybind cheat sheet, LEVEL EDITOR vs Editor, "this browser", the search footer, "× 1" counts, the Finish placeholder, "Not validated" with no explanation.
6. **Project settings tree.** Nest Workshop under its map, move Grid height out, tooltip the difficulty options.
7. **Panel icon tooltips and labels.** Settings › Game's folder icon pairs, Pieces header icons, the Display and Panes triggers.
8. **Light theme contrast.** Grid lines and panel edges one step darker; tint the ortho panes.
9. **About dialog.** Logo, version with copy, links to releases and the repo, licence.
10. **Prefab empty states and Save-as-prefab helper text** to match the Save map dialog.

## Not reviewed

- Native unsaved-changes prompt, Import clash, Overwrite changed, Replace published dialogs (need game-side state or native boxes).
- Release notes (opens an external browser), Update pill (installed builds only).
- Popped-out panel windows.
- Game link's first-run dialog when something is missing (nothing was missing on this machine).
- Drag-and-drop from panels into the viewport, splitter dragging, gizmo interaction.
