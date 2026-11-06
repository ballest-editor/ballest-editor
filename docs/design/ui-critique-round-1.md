# UI critique, round 1

Reviewer: Robin Ebers (role-played). Build: `feat/workspace` at `7fba82a47`, desktop app, dark theme unless noted, 1723×1078 CSS px window. Every screenshot named below lives in `/home/spigelli/.cache/ballest-editor/ui-critique-round-1/` (outside the repo, on this machine).

This is a design review, not a bug list. Each view gets a score out of 10 against the bar of a shipping professional tool (Figma, Blender 4, Godot 4, Fusion 360, Linear). The examples are evidence for the pattern, not the whole fix list. Fix the pattern and the examples go with it.

## Scoreboard

| View                                            | Score      | One line                                                                                         |
| ----------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| Overall                                         | **4 / 10** | Competent bones, no type system, no spacing system, developer vocabulary everywhere.             |
| Top bar and menu bar                            | 5          | Three different text styles in one 40px strip; View menu is a dumping ground.                    |
| Dock: panel strip, document tabs, group menus   | 4          | Default layout truncates its own fourth tab; four places to toggle panels.                       |
| Viewport chrome                                 | 5          | Three shape languages (circle, pill, rounded rect) in one corner; no units on values.            |
| Inspector: map                                  | 4          | A status sentence set in monospace; sliders don't read as control groups.                        |
| Inspector: item and group                       | 3          | Internal class name is the title; mesh and material debug dump at the bottom.                    |
| Outline                                         | 5          | Decent rows, mixed icon system, double-click renames while "enter group" is invisible.           |
| Pieces                                          | 4          | Underscored codes as friendly names; tooltips show asset paths; one unlabeled 12px icon.         |
| Prefabs                                         | 4          | "USER" and "PROJECT" as section names; Open vs Place unexplained.                                |
| Project panel                                   | 4          | Status glyphs nobody can read; header icons without tooltips.                                    |
| Status bar, sync popover, notifications, toasts | 5          | Good idea, but version number is permanent furniture and validation errors become notifications. |
| Menus (content)                                 | 5          | Shortcuts rendered three different ways across the app.                                          |
| Game link dialog                                | 3          | A 660px wall of file paths as the first thing a new user sees.                                   |
| Settings dialog (7 pages)                       | 5          | Sound shell; 60px sliders, a "Coming later" row, a whole page that duplicates another dialog.    |
| Project settings                                | 4          | Editor state and Workshop metadata and file plumbing on one page.                                |
| Save, Rename, Duplicate, New project dialogs    | 3          | Creator and export file name on every dialog; rules as helper text instead of validation.        |
| Recover dialog                                  | 3          | A four-line paragraph before the list.                                                           |
| Project chooser, Where to open                  | 4          | A modal over a fake editor instead of a start screen; mono paths as the row body.                |
| Keybind cheat sheet                             | 6          | Works; only reachable by holding a chord nobody knows.                                           |
| Split panes                                     | 5          | Fine mechanically; scale info stuffed into a view picker; no drag-to-split.                      |
| Prefab definition tab                           | 4          | "Tier user" is internal vocabulary; badge in the tab is 8px.                                     |
| Light theme                                     | 2          | Half the chrome stays dark; sky becomes a white band.                                            |

## Systemic issues (fix these first, they are most of the score)

### 1. There is no type scale

Measured: menubar items 12/500, panel tabs 11/600 uppercase with 0.55px tracking, document tabs 12/400, inspector labels 12/400, search inputs 12/400, piece names 12/500, prefab subtitle 10.4/400, app name 14/600, dialog titles ~16, settings breadcrumb 16/400. Body text in the app is 12px Manrope everywhere, with 10.4px captions and 11px eyebrows under it and nothing between 12 and 16. That is why every view feels flat: labels, values, helper copy, section eyebrows, inactive tabs and the window title all land on the same 12px grey.

What good looks like: pick four roles and stick to them. Caption 11/500 (eyebrows, shortcuts), Body 13/400 (labels, rows, menu items), Body strong 13/600 (titles of rows and selected objects), Title 15/600 (dialog titles, panel headers when needed). Mono only for numbers in editable fields, never for sentences, file names or paths in running UI.

Examples: `03-untitled-project.png` (inspector vs outline vs tabs, all one size), `30-placed-piece-inspector.png` ("ITEM #2" eyebrow, then an internal class name as the biggest text on screen), `22-save-map-untitled-project.png` (a dialog with five labels, all the same weight as the helper text).

### 2. One grey for everything

`oklch(0.705 0.015 286)` is used for section eyebrows, inactive tabs, placeholder text, helper copy, the window title, the version string, the inspector's labels and the status bar. Contrast hierarchy means secondary text is one step down, tertiary two steps, disabled three. Right now there is one step, so a disabled menu item (`04c-menu-Edit.png`) is indistinguishable from an enabled shortcut hint, and "Creator" (a label) looks exactly like "not saved yet" (a status).

### 3. Four border radii, three shape languages

Root radius is 0.45rem. Measured in the wild: menu items 3.76px, inputs 5.76px, dialogs ~10px, every viewport pill 9999px, the "Perspective" picker is a stadium while the four controls next to it are circles, panels are 0. Choose two radii (one for controls, one for surfaces) and one shape for floating viewport chrome. `09-viewctl-3.png` and `15-view-panes-menu.png` show the clash in one 300px strip.

### 4. Developer vocabulary leaks into every surface

A short list, all user-visible:

- `Map_LevelEditorMain&asdf_spigipplespigipplespigipple.balledit` shown in the inspector File row, the Save, Rename and Duplicate dialogs ("Exports as"), the Project settings File row, the status popover and the Project panel tooltip. The user types "asdf"; the app keeps showing them the game's filename everywhere.
- `Level  Map_LevelEditorMain` as a read-only row in Project settings (`17b-map-settings-scrolled.png`).
- `SM_1000_45.SM_1000_45`, `0: M_BaseSurface_Metal`, `M_OutlineEdges (not in the game's picker)` under MESHES and PAINT in the item inspector (`30-placed-piece-inspector.png`).
- `BP_Ramp_Curve1`, `MP_PlayerStart` as item titles while the Pieces panel calls the same thing "Curve1 M" and the outline calls it "Player Start".
- Piece names with underscores: `Bevel_C Hump S`, `Bevel_F Kicker Stub`, `Bevel_F Scoop S1` (`06-panel-PIECES.png`). Hovering a piece shows its class and the `/Game/Maps/_GENERATED/PC/...` asset path as a native tooltip.
- `Tier  user` in the prefab inspector (`77-prefab-tab.png`), `USER` as a section heading in the Prefabs panel.
- `Validated  no` in the map inspector. No user knows what validated means here.
- "Filter by name, class or tag" in the Outline search.
- "Desktop app only" as an option label in Settings › Camera.
- Full absolute paths in Game link, Settings › Game, Project settings › General, the chooser rows, the Where to open dialog and the status popover. Paths are reference material, not UI. Show them on demand (a Reveal button, a hover) and show the friendly name by default.

### 5. Prose instead of UI

The app explains itself in paragraphs. Recover dialog: four lines before the content. Project panel empty state: "No project yet. Saving a map creates one, and these maps can then be saved in it." Prefabs panel: "Name the project to keep prefabs in it." Game link: "Everything Export and Launch game need is here." New project: "A folder of maps, exported to the game one by one." Settings rows carry two-line descriptions on nearly every row. Save map: "Letters, digits and spaces only." as permanent helper text (should be inline validation on a bad keystroke). A professional tool uses one short line, then a tooltip or a Learn more link for the mechanics.

### 6. Spacing has no rhythm

There is no visible 4/8 grid. Inspector lighting rows: 20px label line, 12px slider, 24px gap, and the slider thumb overhangs the container on the right when at max (`03-untitled-project.png`, Sunlight at 12.00). Project panel header: a 12px project name with three 14px icons on the same line and 8px under it to the first row. Panel tab strip and document tab strip are both 32px and look identical even though one selects a panel and the other a document. Dialog padding is 16px on a 400px dialog and 24px on a 700px one.

### 7. Too many entry points, not the right ones

- Rename a map: inspector Name field (live edit), Project row › Rename…, tab right-click › Rename…, Project settings › Name. Four entry points, three different UIs (live field, dialog, settings row).
- Creator name: Settings › General, Game link › Change…, Save dialog › change, Rename and Duplicate dialogs as an editable field. Four places to edit a value most users set once.
- Toggle panels: each of the three group "…" menus, plus the View menu. Yet the tab itself has no close affordance and there is no way to get a closed panel back without a menu.
- Split the viewport: View › Panes › Four panes (three levels deep) or the circle icon top-right. No drag, no tab split, no right-click on the document tab.
- Keybind cheat sheet: hold Shift+/ or find it in Settings › Keybinds. There is no Help menu.
- Export: Project menu, Project row menu, status popover, Play. The labels differ: "Export to game" vs "Exports as" vs "Export on save" vs "Export every save".

## Per view

### Top bar and menu bar (5)

`03-untitled-project.png`, `04-menu-File.png`, `04c-menu-View.png`, `04c-menu-Project.png`, `46-play-tooltip.png`.

- The 40px strip mixes a 14/600 product name, 12/500 menu items, a 12/400 italic centred window title with a trailing `*`, and a green 12px "Play" with a triangle. Four text treatments in one line. The window title and the document tab both signal "dirty" with different symbols (`*` vs `•`).
- Window controls on the user's build sit at the far left (`× ⌄ ⌃` as thin glyphs, see the user's screenshots). Three icons at 11px with no hover states are not window controls; either use the platform's or make them 32px targets.
- Play is the only coloured thing in the chrome but has no button shape. Give it a real button or a proper icon-plus-label pill, and move it next to the sync state it depends on.
- View menu: 17 items in five groups mixing camera commands, panel checkboxes, grid, lighting and theme. "Panes" and "Active pane" submenus have no context (the user's point). "Map lighting / Show sky / Show water" belong with the viewport controls, "Theme" belongs in Settings only.
- Project menu puts "Export on save" (a checkbox) between "Export to game" (an action) and "Re-import from game" (disabled, no reason). Separate the actions from the preferences.
- Shortcut hints are rendered as `Alt + N` in a lighter mono in menus, as chips `Ctrl + S` in Settings › Keybinds, and as `Shift + LMB` chips in the cheat sheet. Pick one rendering.
- File menu has "Check for updates" permanently disabled in dev with no tooltip saying why.

### Dock, panel strip, document tabs, group menus (4)

`03-untitled-project.png`, `13-panels-layout-menu-0.png`, `13-panels-layout-menu-1.png`, `08-tab-context.png`.

- At the default sidebar width (272px) the fourth tab renders as "OU" (the user's screenshot) or "PRI". A default layout must fit its own default content. Either icon tabs, a narrower letter-spacing, or three tabs by default.
- Panel tabs are 11px uppercase with 0.55px tracking in grey, active state is a 2px blue underline. The eyebrow style is reused for inspector section headings, for the status bar's prefab label and for the Pieces category rows, so "tab", "section" and "category" all look alike.
- The "…" group menu repeats the five panel checkboxes in every group and in the View menu. VS Code puts the panel list in the Activity Bar's context only, and the view's own "…" has actions for that view. Here the only view-specific items are Pop out, Collapse, Reset layout, and two of those are disabled on the centre group.
- Document tabs: 12px text, 32px height, same as the panel tabs, with the `+` button looking like a tab. There is no hover close button on inactive tabs, only on the active one. The tab context menu (`08-tab-context.png`) has Close, Close others, Close to the right and nothing else on an unsaved map, so the documented Rename/Duplicate/Reveal don't surface until saved.
- No drag handle, no drop indicator preview was visible in the dock (dockview's default blue overlay is fine, but the tab strip gives no hint it is draggable).

### Viewport chrome (5)

`03-untitled-project.png`, `09-perspective-dropdown.png`, `15-view-panes-menu.png`, `15-grid-size-list.png`, `15-rotation-step-list.png`, `12-toolbar-tooltip.png`, `37-four-panes.png`.

- Top-left "Perspective ⌄" is a stadium; top-right is four circles (one pane, world/local axes globe, grid with "10", angle with "15.0°"); bottom-centre is a stadium with four circles inside. Three shape languages in one viewport.
- The values in the pills have no units: "10" is centimetres, "15.0°" has a pointless decimal. The grid pill's listbox items read "1 cm … 1000 cm" but the pill says "10". The axis toggle icon is a globe when world and a cube when local, with no label; a tooltip exists but takes 500ms.
- The pane picker items (`15-view-panes-menu.png`) have icons and the perspective picker items (`09-perspective-dropdown.png`) do not. Same component family, different treatment.
- In split layouts each pane's picker says "Top · 1 px = 4 cm" (`37-four-panes.png`). The scale is useful but it is the only place in the app that shows a zoom readout, and it is hidden inside a dropdown trigger. Put scale in the status bar or a pane corner.
- The gizmo and toolbar: the active tool is a solid blue circle, inactive are white glyphs on a 60% black stadium. Fine. But there are no tooltips on hover in practice (the delay plus pointer behaviour meant none appeared in testing), and no labels or shortcut hints (Q W E R are only in Settings).
- The sky renders as a flat dark band above the grid horizon in dark theme and a white band in light theme (`38-light-theme.png`). It reads as a rendering bug, not a sky.
- Axis gizmos in ortho panes are 24px line glyphs at bottom-left with no background; on a busy map they will vanish.

### Inspector: map (4)

`03-untitled-project.png`, `32-inspector-goal.png`.

- "MAP" eyebrow with a 14px cog on the far right (the user's complaint; 14px hit area for the single most important secondary action here).
- Rows: Creator, Items, Created, Validated, File. "Validated no" is unexplained. "File not saved yet" is a sentence in monospace. "File …pplespigipplespigipple.balledit" truncates from the left and shows the wrong part.
- Created date "Nov 5, 2026, 7:59 PM" is the only piece of 12px text with a comma-separated date format in the app; elsewhere "08:13 PM", "2 min ago", "Nov 5, 2026, 8:13 PM (just now)". Pick one relative plus one absolute format.
- LIGHTING: label at left, a 100px mono numeric field at right, slider on its own line below, repeated three times. The field and the slider are two controls for one value and they are stacked instead of inline, so each setting is 44px tall with no card or divider. Values have no units and "Time of day 7.30" is a time shown as a decimal.
- The Name field is the only live-edit rename in the app; everywhere else renaming is a dialog. Decide.

### Inspector: item and group (3)

`30-placed-piece-inspector.png`, `41-inspector-multi.png`, `43b-inspector-group-selected.png`.

- Title is the internal class (`BP_Ramp_Curve1`, `MP_PlayerStart`), eyebrow is "ITEM #2" (the index in the file, which changes). The friendly piece name is nowhere in the inspector.
- Duplicate and Delete sit at the top as outline and destructive buttons. Destructive red in the inspector's first 60px is loud; Delete has Backspace and a context menu.
- TRANSFORM: 3×3 mono fields with 4px coloured left bars for X/Y/Z, 14px row icons for move/rotate/scale at the left, no X/Y/Z letters anywhere and no units (cm, degrees, factor). Flip X / Flip Y as two full-width outline buttons under scale, visually as important as the transform itself.
- PIVOT: nine buttons in a 1/2/3/2 grid, "Default" styled as a primary CTA because it is selected. A selected segment in a toggle group must not look like the Save button.
- PAINT: "Slot 1 [Material ⌄]" followed by a mono one-liner that gets cut off mid-word: `M_BaseSurface_Metal (not in the game's pick…`. Slots should show a swatch, the material's friendly name and a picker.
- PROPERTIES: "Surfaces [Default]". MESHES: raw mesh and material identifiers with indices. That is a debug panel. Move it behind a "Details" disclosure or remove it.
- Group of one item: GROUP section with Name and Tags, then ITEM section with the full item inspector, so "Tags" appears twice in 300px (`43b-inspector-group-selected.png`). Multi-select shows nothing special (`41-inspector-multi.png` is just one item). A group should summarise (n items, bounds), not nest a full item editor.
- Transform row icons are popover triggers for copy/paste of X/Y/Z, with Shift+click shortcuts. Nothing in the UI hints at this.

### Outline (5)

`31-outline-3-items.png`, `43-outline-group.png`, `44-outline-context.png`, `45-entered-group.png`.

- Rows are 24px with 14px icons: a yellow dot in a square for Player Start, a ring for Goal, a rendered teal thumbnail for pieces, a folder for groups. Glyph for specials, thumbnail for meshes, folder for groups is three icon systems in one list. Use one: glyph per category, or thumbnail everywhere.
- The group count "1" at the far right of the row in grey has no meaning without a label; a chevron plus indentation already says it is a group.
- Double-click on a group renames it inline (`45-entered-group.png`), which is the VS Code convention, but the documented "enter group" mode is now undiscoverable (no breadcrumb, no status text in testing).
- Context menu (`44-outline-context.png`) is reasonable. Missing: Select all in group, Hide/Show, Lock, which every scene outliner has. Both "Rename F2" and "Edit tags…" exist but the inspector also edits tags live.
- The "Collapse all groups" header button appears only on hover and only when groups exist. Fine, but an icon-only 14px target.
- Filter placeholder "Filter by name, class or tag" should be "Filter".

### Pieces (4)

`06-panel-PIECES.png`, `29-pieces-search.png`.

- Rows: 32px thumbnail, 12px name, 42px tall. The thumbnails are all the same teal material from the same angle; at 32px Curve1 S, Curve1 M and Curve1 L are the same picture. Either make size differences visible or add a size tag.
- Names: `Bevel_C Hump S`, `Bevel_F Kicker Stub`, `Bevel_F Scoop S1`, `AJ 500 kicker1 M Clear Coat M Out…`. These are catalogue codes with spaces inserted. Give pieces real display names and keep the code in a tooltip.
- Hover tooltip is the native `title` with class and asset path (`BP_Ramp_Curve_Short1` + `/Game/Maps/_GENERATED/PC/SM_500_45scoop.SM_500_45scoop`).
- Search field has a 12px icon at the right that looks like upload. No label, no tooltip appeared.
- Category header "RAMPS 30" uses the eyebrow style; "HIDDEN (NOT IN THE IN-GAME BR…" truncates (`29-pieces-search.png`).
- Click places a piece instantly, 20m from the camera, and the panel gives no feedback (no pressed state, no toast, no "placed" flash on the outline row). First-time users will click three times and get three pieces.
- No grid view, no size filter, no favourites, no recent. For a 150-piece catalogue, a single list is slow.

### Prefabs (4)

`06-panel-PREFABS.png`, `18-prefab-more-menu.png`, `76-prefabs-named.png`, `77-prefab-tab.png`.

- Sections "PROJECT" and "USER". "User" means "the game's own prefab folder"; call it "Game" or "In game". The empty states are sentences ("Name the project to keep prefabs in it.", "This project has no prefabs yet.").
- Row: 32px thumbnail, name at 12/500, "2 items" at 10.4px. A `⋮` on hover. The menu has Place, Open, Rename…, Duplicate, Copy to project, Delete…, Reveal. "Open" vs "Place" is the key distinction and nothing explains it. Ellipsis usage is inconsistent: Delete… has one, Duplicate does not but immediately writes a file.
- The prefab tab shows "asdf" with a 8px "user" superscript badge and a tiny prefab glyph (`77-prefab-tab.png`). The badge is unreadable and the word is wrong (see above).
- Prefab inspector: "PREFAB ASDF / Tier user / Items 2 / File …/Saved/SaveGames/Prefabs/asdf.json". Tier is internal; the file row again.
- Drag from the panel into the viewport is supported for pieces per the docs, but there is no drag affordance (no grip, no cursor change on hover).

### Project panel (4)

`06-panel-PROJECT.png`, `61-project-panel.png`, `63-project-row-hover.png`, `64-project-row-menu.png`, `70-new-map-tab.png`.

- Header: project name at 12/500 (italic plus `*` when untitled) and three 14px icon buttons: `+`, a copy-like glyph that is actually Import, a cog. No tooltips appeared on hover in testing. The user is right that `+` should ask what to add (map or prefab) or the two should be two buttons.
- Rows: 16px map glyph, name, and a status glyph at the right: dotted circle (never exported), pencil (edited since export), green check (in sync). The dotted circle is unreadable at 14px and the three states have no legend. Use a text badge or the status bar's wording.
- Untitled project empty state is a two-sentence paragraph.
- Row menu (`64-project-row-menu.png`): Open (disabled when open), Rename…, Duplicate…, Recover previous version…, Export to game, Play, Reveal. Mixed verbs and nouns; "Recover previous version…" is three words for "History…" or "Backups…".
- The dirty map in the list is italic with a dot (`70-new-map-tab.png`), the same visual used for an untitled project name. Italic is doing two jobs.

### Status bar, sync popover, notifications, toasts (5)

`60-named-project.png`, `73-status-click.png`, `16-notifications.png`, `82-notifications-one.png`, `71-save-map-named-project.png`.

- Left: `v0.1.0` permanently. The version belongs in About or Settings › General, not in the status bar of every window.
- Centre: `◌ Not exported`, `✓ In sync · exported just now`, `✎ Edited since export · exported 2 min ago`. Good concept, good copy. The icon is 12px and the whole thing is a 12px grey string on a 24px bar; it is the most important state in the app and it reads as a footnote. Make it a clickable chip with a colour.
- The popover (`73-status-click.png`) is 400px wide, title, two-line explanation, "Export" with a mono truncated filename, "Last export", three buttons. Drop the explanation and the filename; keep the time and the actions.
- Notifications: a bell with an unread count at the far right of a 24px bar. The popover has a title row with "Mark all read / Clear" as text buttons, then rows with icon, text, time and a Reveal button. OK. But `Select 2 to 4096 items before saving a prefab.` (a validation message) lands as an error notification and a toast at once (`78-save-prefab-dialog.png`). Validation belongs at the control, not in the inbox.
- Toasts bottom-right are 380px wide with a 12px body and a small outline button. Fine, though the toast and the notification popover use different row layouts for the same message.

### Menus, content (5)

`04-menu-File.png`, `04c-menu-Edit.png`, `04c-menu-View.png`, `04c-menu-Project.png`.

- File: New map, New project…, Open project…, Recent projects ›, Save, Close tab, Settings…, Game link…, Check for updates, Quit. Settings and Game link under File is odd; Game link is a settings page already. No Export here (it is under Project), no Import.
- Edit: all items disabled with no selection; the disabled grey is so close to the enabled grey that the menu looks broken.
- View: see systemic 7.
- Project: New map (also in File), Import map…, Export to game, Export on save (checkbox), Re-import from game, Play, Launch game, Project settings…. "Launch game" next to "Play" is confusing; "Play" exports and races, "Launch game" just starts Steam.
- Submenus did not open on hover in my automated run, which is not a user problem, but the "›" chevron is 10px and light grey.

### Game link dialog (3)

`01-first-launch.png`, `20-settings-Game.png`.

- First launch opens a 700×660 modal with five rows: Game, Maps folder, Creator, Plugin manager, Editor plugin. Each row: green check circle, title, description, then a full-width mono path (left-truncated: `…0/pfx/drive_c/users/steamuser/AppData/Local/Ballest/Saved/UserSavedMaps`) and two 14px icon buttons. This is a diagnostics page, not onboarding. When everything is found, the right first-run experience is a one-line "Game found" and the editor; when something is missing, show that row only.
- The Creator row has a "Change…" button right-aligned to the title line while the other rows have their buttons on the path line, so the right edge zigzags.
- "Check again" is a text link inside the card's bottom border; Done is a primary button outside it. Two footers.
- The same content is duplicated as Settings › Game, with the same paths. One home.

### Settings dialog (5)

`20-settings-General.png`, `20-settings-Editor.png`, `20-settings-Camera.png`, `20-settings-Keybinds.png`, `20-settings-Keybinds-2.png`, `20-settings-Appearance.png`, `20-settings-Lighting.png`, `20-settings-Game.png`, `39-theme-select-open.png`.

- Shell is the right pattern: search, sidebar with icons, breadcrumb, rows with title/description/control, reset-per-page, Done. Keep it.
- Row descriptions are long and on nearly every row ("Alt+drag on a translate handle moves a copy and leaves the original in place, like the game. Off: Alt+drag is a plain move."). That is a tooltip or a Learn more.
- Sliders are 60px wide with the value beside them (`Placement distance ——○ 20 m`, `Look sensitivity ×1.0`). A 60px slider for a 1–100 range is a decoration, not a control. Use a 160px slider plus a numeric field, the same component the inspector should use.
- "Autosave — Coming later." as a disabled row with a disabled switch. Remove until it exists.
- "Updates — Ballest Editor 0.1.0. Updates only run in an installed build." plus a "Check for updates" button that is also in File. One place.
- Camera: "Field of view: Default (fov 90)" then a disabled "Custom field of view" slider row. Make the custom slider appear when Custom is chosen. "Lock pointer while looking: Desktop app only" exposes platform plumbing as an option label.
- Keybinds: action names are lowercase ("select", "translate", "local / world axes", "keybind cheat sheet") while every other label in the app is sentence case. Chips plus a `+` to add; no visible way to remove a binding without hovering. Sections are fine.
- Appearance: "Grid colour (1 m cells)" with a 14px swatch and the word "Automatic" in mono. Show the resolved colour.
- Lighting is a page with two switches. Fold it into Appearance.
- Game duplicates Game link (see above).
- The Theme select (`39-theme-select-open.png`) opens a 160px listbox with Dark/Light/System; the Appearance sidebar item then gets a blue dot to show "changed from default", which is the only place in the app that marks a non-default value.

### Project settings (4)

`17-map-settings-dialog.png`, `17b-map-settings-scrolled.png`, `17c-project-settings-general.png`, `74-project-settings-named.png`, `75-project-settings-map-named.png`.

- Same shell as Settings, which helps. Sidebar: PROJECT › General, MAPS › each map. Good.
- Map page mixes four kinds of thing: identity (Name, File, Level), editor state (Grid height), sync preference (Export on save), and Workshop metadata (Difficulty, Gameplay tags, Mood tags, and more below). Grid height is a viewport setting, not a map setting. Level is read-only internal. Split into "Map" and "Workshop" pages, drop Level.
- File row shows the full game filename with edit and copy icons. Renaming via a pencil here, via a dialog in the panel, and live in the inspector is three rename UIs.
- Difficulty: five icon-only toggles (1–4 coloured bars and a warning triangle) with no labels; "Not set." as the description. Label them (Easy, Medium, Hard, Expert, Unfair or whatever the game calls them).
- Tag chips wrap into two rows of 16 chips with no selected state visible when none are selected. Fine, but 16 identical outline chips is a lot of grey.
- General page: Name, then LOCATIONS with four full-width mono path fields (Project folder, Maps, Backups, Exports). For a new project they all say "Made when the project is named" in italic inside a disabled input. A disabled text field holding a sentence is the wrong control for "this does not exist yet".

### Save, Rename, Duplicate, New project dialogs (3)

`22-save-map-untitled-project.png`, `71-save-map-named-project.png`, `65-rename-dialog.png`, `66-duplicate-dialog.png`, `21-new-project.png`.

- Save map (named project): title, "Saves it in my second project.", Map name field, "Letters, digits and spaces only.", "Creator: <steam name> change", "Exports as" with a left-truncated mono filename, Cancel/Save. The user is right on all three counts: creator does not belong here, the filename does not belong here, and the rule belongs in validation. A Save dialog is one field and two buttons.
- Save map (untitled project) adds Project name and Project folder (mono path plus folder icon). Five inputs on a first save. The first save should create the project silently in the default folder and let the user rename or move it later; or split into "Save" then "Where should this project live?".
- Rename and Duplicate are the same dialog with a Creator field and the sentence "The map's creator; Settings › General keeps the one new maps get." (that sentence does not parse). Rename is one field.
- Duplicate map's description "Saves a copy of the map as it is now and goes on editing the copy. The original keeps its last save." is two sentences where "Duplicate" was enough.
- New project is the only clean dialog: title, one line, one field, path, two buttons. The placeholder "Season 3 tracks" is good. The path under the field in mono is still a path.
- The primary buttons are 28px and the dialog titles are set in a different cut (looks like a geometric display face) than the body, which is the only place that face appears.

### Recover dialog (3)

`67-recover-dialog.png`.

- Title, then a four-line paragraph about when backups are made, then "asdf | All backups" as two text toggles, then an empty 290px list box with another two-sentence explanation, then Close. The user opened this to see versions; show the list first, the explanation never, and the toggle as a segmented control.

### Project chooser and Where to open (4)

`80-chooser.png`, `81-chooser-new-project.png`.

- The chooser is a 540px modal over a blurred editor that the user cannot use yet. A tool like this opens on a start screen (recent projects as cards, New, Open, maybe a sample), not on an editor pretending to be behind a dialog. The mockup in `docs/mockups/welcome.html` already describes that.
- Rows: name at 12/400, "· Open in another window" inline after the name in the same grey, then the full path in mono, left-truncated. The path is the biggest text in the row and the least useful. Show name, parent folder, last opened.
- Buttons: "Open project…" outline and "New project" primary are right-aligned above the list, "Quit this window" ghost at the bottom-left. Three buttons in three places.
- "Start a new project" state: "This window has no project yet. Name a new one to work in." then a Name field and a mono path. "Back" and "Create" at the right, "Quit this window" at the left.
- Where to open (described from `WhereToOpenDialog.tsx`, not captured): "This window is on X. Open Y here in its place, or in a new window?" with This window / New window / Cancel and "Always do this". This question is asked on every project switch. Default to "this window" and offer "New window" as a secondary action in the Recent menu instead.

### Keybind cheat sheet (6)

`23-cheat-sheet.png`.

- Three columns, section eyebrows, chips right-aligned. Readable. The sections are "Level editor, Edit, Mouse and keyboard free camera, Mouse and keyboard bindings, Editor camera, View, File, Game, Help": three camera sections with overlapping content.
- It only shows while Shift+/ is held, which nobody will find. Put it in a Help menu and let it stay open.

### Split panes (5)

`37-side-by-side.png`, `37-four-panes.png`.

- Mechanically fine. The active pane has a 1px blue outline; the inactive panes' pickers are identical to the active one. Scale text in the picker (see viewport). The floating top-right controls stay in the top-right pane's area even though they apply to the active pane.
- There is no splitter affordance between panes and no drag to resize visible.
- The user's proposal (split from the tab, then a view cube) is the right direction; a view cube would also replace the "Active pane" submenu entirely.

### Light theme (2)

`38-light-theme.png`, `38-light-settings-appearance.png`, `38-light-menu.png`, `38-light-project-settings.png`.

- Panels, menus and dialogs switch to light correctly. The viewport chrome does not: "Perspective" pill, the four circle controls, and the bottom toolbar stay black on a pale UI. The sky becomes a white band above a pale blue grid plane. The selection outline and gizmo colours are tuned for dark.
- The light palette has almost no contrast between the panel background, the input background and the row hover.
- Ship dark only until light is finished, or finish it.

## Flows: how many clicks the common things take

| Task                            | Today                                                                    | Target                                                                        |
| ------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| First launch to an empty map    | Game link dialog (read five rows), Done                                  | Editor opens; a one-line banner if something is missing                       |
| New map, first save             | Alt+N, Ctrl+S, read 3–5 fields, Save                                     | Ctrl+S, type a name, Enter                                                    |
| Switch project                  | File › Recent › name, Where to open? › This window, maybe unsaved prompt | File › Recent › name (opens here); New window as a modifier or secondary item |
| Rename a map                    | 4 entry points, 3 UIs                                                    | Inspector field and tab/row Rename, same inline UI                            |
| Split the viewport              | View › Panes › Four panes                                                | Right-click the tab › Split, or drag a splitter; view cube per pane           |
| Find a piece by size            | Scroll a 150-row list                                                    | Grid view, size filter, favourites                                            |
| See the keybinds                | Hold Shift+/                                                             | Help › Keyboard shortcuts                                                     |
| Check why Export is unavailable | Nothing; menu item just disabled                                         | Disabled item with a reason tooltip, or a status chip                         |

## What to do first

1. Type scale and grey scale. Four text roles, three greys. Apply across panels, dialogs, menus. This alone moves most views up two points.
2. Friendly names everywhere; file names, paths and class names behind Reveal, tooltips or a Details disclosure. Kill "Exports as" in every dialog.
3. Save/Rename/Duplicate become one-field dialogs with inline validation; creator moves to Settings only.
4. Inspector: friendly title, group summary instead of nested item editor, slider-plus-field as one 28px row with units, Pivot as a segmented control, MESHES behind Details.
5. Panel chrome: fit the four tabs, one "…" with view actions, panel list in View only; icon buttons at 16px with tooltips at 300ms.
6. Viewport chrome: one shape, units on values, tooltips with shortcuts, view cube.
7. Game link becomes a status row in Settings › Game and a first-run banner only when something is missing.
8. Start screen instead of the chooser modal.
9. Light theme: finish or hide.

## Not reviewed

- Native unsaved-changes prompt (Save / Don't save / Cancel is an Electron message box; copy only from code).
- Import clash, Overwrite changed, Replace published dialogs (need game-side state; copy read from code, same prose problem as Recover).
- Update pill and release notes (installed builds only).
- Popped-out panel windows.
- Game link error states (everything was found on this machine).
- The web review build (not a product).
- Drag-and-drop from the panels into the viewport, and gizmo interaction at the pixel level.
