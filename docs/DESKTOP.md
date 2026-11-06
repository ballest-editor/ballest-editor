# Desktop app

Status: shipped. Ballest Editor is an Electron app for Windows and Linux, and prereleases are on the [releases page](https://github.com/ballest-editor/ballest-editor/releases). This page began on 2026-10-30 as the plan for milestone 0.2 and now describes what was built. § What differed from the plan lists the changes. The [milestones](https://github.com/ballest-editor/ballest-editor/milestones) track what's left.

The web review build stays, but only for reviewing pull requests and `main`. How the main process works, and how to develop it, is in [apps/desktop/README.md](../apps/desktop/README.md).

## Why desktop

- **Egress.** The game's meshes and textures (61 MB compressed) were served to every browser session from a hosted object store. A public website would pay for that on every visit. A desktop app ships them once, inside the installer.
- **The game is local.** The maps folder, the game launch and Play all need the file system and the shell, which a browser doesn't get.
- **No server.** The app has one route and no server functions, so server rendering bought nothing for a WebGL editor and cost a hydration workaround. It's a plain Vite SPA now.

The move changed none of these: positions in centimetres, quaternions, the UE frame, the `MapFile` and `Catalog` schemas, the layer rules, Effect for everything non-trivial.

## Code layout

The split follows [t3-code](https://github.com/pingdotgg/t3code) (`apps/web` + `apps/desktop` + `packages/contracts`), which also runs Effect v4 in the Electron main process. [AGENTS.md](../AGENTS.md) § Layout lists every package.

There is no `packages/core` yet. `domain/` and `services/` are already platform-neutral and have one consumer, the renderer. The main process needs none of them: it moves bytes, finds folders and launches things. Extract a core package when a second consumer exists. The lint rules keep the boundary clean until then.

## Renderer

### One app, one `Platform` service

The renderer never imports `electron`. It gets a `Platform` service (`apps/web/src/services/Platform.ts`) with two layers:

| Capability         | Browser layer       | Desktop layer (through `window.ballest`, the preload bridge) |
| ------------------ | ------------------- | ------------------------------------------------------------ |
| Open / Import      | `<input type=file>` | native open dialog; the file is copied into the project      |
| Save               | download link       | writes the map in the project, asking nothing                |
| Export to game     | hidden              | copies the project map into `UserSavedMaps`                  |
| Open game, Play    | hidden              | `steam://rungameid/3339810`, plugin handoff                  |
| Open external link | `window.open`       | `shell.openExternal`                                         |
| Updates            | none                | electron-updater state stream                                |

`Platform.layer` is picked at module load: `window.ballest !== undefined` means desktop. The preload runs before any page script, so that test is reliable. Components still reach it through `editor/actions`. Settings, keybinds, map prefs and the dock's layout stay in `localStorage`, which Electron persists under `userData`.

The web review build has no project. Its maps live in tabs in memory, each with its structure and no sidecar file: Open is the file input, and Save and Export download the `.balledit`.

### Projects and maps

On desktop the maps live in a project folder ([PROJECTS.md](PROJECTS.md)). File › New project… makes one at `Documents/Ballest Editor/<name>`, and the first Save in an untitled window makes one where its dialog says (`Projects.createNew`, IPC `ballest:project:create`). File › Open project… chooses any folder, and the recent ones are under File › Recent projects. New project…, Open project… and Recent projects ask where the project opens first (§ Other windows). The first Save doesn't: this window becomes the project it makes.

Until one is used, the window is **Untitled Project \***: `ProjectState.current` is null, nothing is on disk, and main refuses to write a map (`noProject`). The title stays that until the first Save, and the Project panel says that saving a map creates a project. The game's maps folder, or a folder inside it, is refused with the reason: the game scans its subfolders and rewrites what it finds.

- **New map** (File, Project, the + on the tab strip, the Project panel's header, Alt+N) adds a tab, in any window, with no dialog and nothing written. The map goes by Untitled, Untitled 2, Untitled 3… (the lowest number the open tabs leave free) until its first Save, and it never names or replaces the map beside it. Its creator comes from Settings › General or Steam, and with neither the first Save asks.
- **Save** (Ctrl+S) writes the project file, then its sidecar (`ballest:project:writeSidecar`, [PROJECTS.md § The files](PROJECTS.md#the-files)), and asks nothing. A map that has no file yet is named first, in the Save map dialog (`components/NameMapDialog.tsx`), which asks only the name: Settings › General gives the creator, and with none to use the dialog says so and offers Settings. In Untitled Project that dialog also asks the project's name (My Maps, numbered past the recent projects) and shows where it goes by name, `Ballest Editor › <project name>`, with the path in a tooltip and Change…, the folder dialog Open project… uses. Save makes the project, this window becomes it, and the map goes in it. The other tabs stay open, unsaved, and each is named by its own first Save. Cancel leaves nothing on disk, and a project main refuses leaves the dialog up with the reason. After the name or creator changed, Save moves the file to the new name and the old one goes to `<project>/.ballest/backups/`.
- **Rename** and **Duplicate** (a map's menu in the Project panel) replace Save as. Rename changes the name and moves the file and its sidecar. Duplicate saves a copy under a new name with a sidecar of its own, and editing goes on in the copy. Both ask only the name and keep the map's creator, or use the one from Settings › General when the map has none a file name can hold. Rename refuses a name the project has; Duplicate offers to replace that map, which then goes to backups.
- **Import** (Project › Import map…, Ctrl+O) replaces Open. A `.balledit`, `.ballmap` or `.json` from anywhere is copied into `maps/` under the game's file name for it and opened from there: a `.balledit` byte for byte, a `.ballmap` as the `.balledit` the game would make of it. Its origin goes into `.ballest/link.json`, and a file imported from the game's maps folder under its own name is linked as that file's export from the start. A name the project already has asks: Replace (the project's copy and its sidecar go to backups) or Import as copy (`<name> 2`). Import is off in Untitled Project.
- **Export to game** (Project menu) saves unsaved edits, then copies the project file byte for byte into the game's maps folder and records the export's path, hash and time in `link.json`. The page first runs Save's checks on the open map, because an imported file or a map with no edits reaches the game without passing through Save. A file past the game's character limit is refused at this step, on the bytes about to be copied, and nothing is written. A file in that folder whose `levelPublishedFileId` is above 0 is a published map's draft, and the editor asks before replacing it.
- **Export on save** (the map's entry in Project settings; off by default, kept with the map's prefs) makes every Save of that map export too. Settings › General › Export every save does it for every map. The first Save of a new map doesn't export under either.
- **Open game (Steam)** (Project menu) opens `steam://rungameid/3339810`, or says the game is already running.
- **Backups.** Every write over a map file keeps the old one first (§ Backups). Backups… in a map's menu in the Project panel lists them.
- **Toasts** name the project or the maps folder and offer Reveal.
- **Unsaved changes** are asked about before anything would lose them: closing the window, reloading, quitting, closing a map's tab, replacing a map open in a tab (Re-import, Recover, Import's Replace), and leaving a named project ([§ Window](#window) has the rule for switching projects). New map, opening a map and Import open a tab of their own and ask nothing.

### Document tabs

`components/DocumentTabs.tsx` puts a tab over the viewport for each open map, each with its own history, selection, grid height and camera view. The web review build has tabs too, for maps in memory.

- Opening a map (the Project panel, a notification's Open) makes its tab active, or opens it in a new tab after the active one. Import and Recover of a map that isn't open do the same. New map always adds a tab after the active one. Opening a map shows no toast.
- A **blank tab** is a fresh map nobody has touched: what the app starts on, what New map adds, what closing the last tab leaves (`isBlankTab`). It holds nothing to lose, so closing it asks nothing, a map opened while it is the active tab takes its place, and a switch of projects drops it (§ Window). New map is the one thing that never reuses it.
- The store keeps the active tab's state where every edit works and parks the others (`TabState`, `parkedTabs`). A save lands in the tab it started from.
- There is always a map, never a Start tab or an empty editor. The required chooser (§ Other windows) holds the fresh map too, though it shows no editor. On launch the app opens the map that was open when it last ran, else the project's most recently edited map, else a fresh unsaved map (what New map starts, named Untitled, nothing written; its first Save names it into the project).
- The active tab's map is kept per project in `desktop-settings.json` (`project.lastOpenMap`, by project folder; `ProjectState.lastOpenMap`, IPC `ballest:project:rememberOpenMap`), written whenever the active tab's file changes after the startup load. The other tabs aren't reopened yet.
- A tab shows the map's name without the creator (`mapLabelOf`), its tooltip is its name and status (Unsaved, else the map's link state, else Saved), and tabs can be dragged into another order.
- A tab's ×, a middle click or Ctrl+F4 closes it after the unsaved-changes prompt (§ Window). Closing the last one shows a fresh map the same way.
- A right-click opens the tab's menu at the pointer: Close, Close others, Close to the right, Split right and Split down (the tab's view goes to two panes, § View panes), and on desktop Rename…, Duplicate… and Reveal, which are off until the map has a file.
- A tab can hold a prefab's definition instead of a map (§ Prefabs). `TabState.document` says which, and it is one tab model: Save, the prompts and the menus ask it.
- Ctrl+Tab and Ctrl+Shift+Tab, or Ctrl+PageDown and PageUp, cycle the tabs.

### Dock

`components/dock/` is everything between the top bar and the status bar, built on [dockview](https://dockview.dev/) (`dockview-react`): the **centre group** with the panels around it, each of which can be dragged to any side of the centre, stacked as tabs, split, resized, collapsed, closed or popped out.

**The centre group** holds the map tabs and the one viewport, which divides into panes of its own (§ View panes). Its only permanent panel is `documents`, whose dockview tab is hidden: `DocumentTabs` stands in for it, in the group's header. It can't be closed, dragged or popped out. The viewport keeps its own `renderer: "onlyWhenVisible"`, so it sits in the page's flow and resizes in the same frame as the window. A panel can be dropped on the centre's sides, but can't join it as a tab. Dropped there, a panel takes its side's usual size, not dockview's half of the viewport.

**Panels** are entries in `components/dock/panels.tsx`: an id, a title, an icon, a component and a default location (`left`, `right`, `bottom`). That entry is all a panel needs for a tab, a View menu item, a place in the default layout, and a place in layouts saved before it existed. `dockControl.ts` is what the rest of the app calls (`togglePanel`, `resetDockLayout`). It's in the page's first chunk, because the menu bar is, so the registry reaches it from `Dock.tsx` and keeps the panels, and WebGL, out of that chunk.

- **Project**, **Pieces**, **Prefabs** and **Outline** start stacked on the left, with Outline in front, and **Inspector** on the right. A panel `always` rendered (Pieces) stays in the page behind another tab, so a long list keeps its scroll position.
- View lists every panel, checked while it's open, and Reset layout. Reset closes everything around the centre group and lays out the default again, and the viewport stays mounted.
- **A panel's tab** shows its icon and title. A strip too narrow for every title keeps the active tab's, and narrower still only the icons (`dock.css`); a hidden title is the tab's tooltip. A tab with a title keeps a place for its ×, which shows under the pointer, so hovering moves nothing. A tab down to its icon has no ×, as the icon is what picks it. A middle click closes any tab.
- **A closed panel** comes back in the slot it left, in front (`panelSlots.ts`). A slot counts the group's other closed panels, so several come back as they were in any order. If the panel would join a different group, or its group has gone, it lands at the end of the strip. Reset layout forgets the slots.
- **A closed panel's icon** stays in a strip, dimmed, and a click reopens the panel (`closedPanelsIn`). It follows the tabs of the group the panel would come back to. With that group gone, or folded to a rail, it sits at the end of the centre group's strip, before the "…".
- **Each group's "…"** (`GroupMenu.tsx`), at the end of its strip, holds Pop out, Collapse and Close panel for the panel in front, Panels › with the closed panels (when there are any), and Reset layout. The centre group has only the last two. The list of every panel is in the View menu.
- **Collapse** folds a group: a column by the viewport to a rail, a group in a stack to its header. A group can't fold if its neighbours have nothing left to give, so Collapse is off there. A panel arriving unfolds it, and so does a click on a tab, with that panel in front.
- **The rail** is 28 px of the panels' titles, read downwards, and nothing else. It's the group's own strip with its header turned to the side, marked `data-dock-rail` and drawn by `dock.css`.

**Sizes.** A window resize goes to the viewport and the panels keep theirs, like closing a group: dockview would even out the group's neighbours. Neither has an option in dockview, so `dockControl.ts` sets the centre group's `priority` and wraps `gridview.remove`. A dockview upgrade should be checked for these.

**The layout** is saved in `localStorage` under `ballest-editor.dock.v1`, a moment after each change and when the page goes away: dockview's `toJSON`, the panel ids it was saved with (`known`), the room around the centre (`hint`), the collapsed groups' sizes and the closed panels' slots. `domain/dockLayout.ts` holds the rules for reading it back.

- A panel in `known` but not in the layout was closed by the user, and stays closed. One not in `known` is new and gets its default place.
- A panel in the layout that the app no longer has is dropped (`onlyPanels`), and a group left empty gives its room to the viewport.
- A layout that doesn't decode, has a size that isn't a number, has no centre or that `fromJSON` refuses is dropped for the default.
- The first paint is the saved layout: index.html sets `hint` as `--dock-<side>` on `<html>`, and `EditorSkeleton` lays out to them, first while the editor's chunk loads and then over the dock until its layout is in.

**Popout** (Pop out in a group's "…") moves the active panel to a window of its own. Closing that window, or the button in its strip, puts it back where it was. Dockview's popout is a `window.open` of `public/popout.html` whose document the main page fills itself, so the panel stays in the same React tree and store. In-window floating groups are turned off.

- **Desktop.** `DesktopWindow` lets the page open that one URL (`isPopoutUrl`) and nothing else, as a same-origin child: sandboxed like the main window, floating over it and closing with it. It has no native title bar: its tab strip is the title bar, as the top bar is for the main window, and main recolours it with the main window (`setColors`). F11 is that window's, and Ctrl+Q closes the main window, where unsaved changes ask.
- **Web review build.** The same `window.open`. A blocked pop-up leaves the panel where it was, with a toast.
- **A window doesn't come back on launch.** A browser would block it and dockview would lose the panel. Closing or reloading the main window docks the panels first, and `dockedPopouts` does it for a layout saved popped out, after a crash. An unload that's being held for unsaved changes leaves them alone, in case it's cancelled.
- **The second window has a realm of its own.** Popups in a panel portal to the panel's window through `PortalContainerContext` (`packages/ui`), or they'd open in the main window. `instanceof Element` doesn't hold for what's in it, hence `elementOf`. Listeners in a panel use the window the panel is in. A panel coming back renders afresh, losing local state such as a search, because its elements belong to a window that's gone. Dialogs open in the main window, which takes the focus.
- `popoutWindow.ts` adopts each window: the main window's `class` and `style` on `<html>` (theme, `--motion`) are mirrored to it, and it gives keys it doesn't use to the main window, where the keybinds listen.

**Keys.** The rules are `isEditorKeyEvent`'s (`editor/keyTargets.ts`): a text field, a dialog or a menu keeps its keys, and everything else drives the editor. Chrome hands focus back after a click (`blurChromeAfterClick`), so the keys work again straight away. A dialog leaves the focus on the page when it closes, however it was closed and whatever opened it (`DialogContent`'s `finalFocus`).

Dockview is themed in `components/dock/dock.css` with the tokens from `packages/ui`, so it follows light and dark and `--motion`. A panel strip is 28px and the document tabs and a popped-out strip 32px (`docs/design/ui-system.md`). Strips are `--background` and panels `--card`, so tone separates them and nothing runs under a strip: the one hairline is dockview's separator, where two groups meet. The active tab rises to `--card`, and its `--primary` underline is one line per strip, a CSS anchor on the active tab that slides to the next. A rail's active tab keeps a line of its own instead. A drag shows a copy of the tab on a card, or of the whole strip when it's a group's (`dragImage.ts`), over dockview's image, which has no option for it. A dockview upgrade should be checked for this too.

### View panes

The viewport is one canvas divided into **panes**, each its own camera on the same map. Selection and the document are shared; only cameras differ. The dock knows nothing of this: to it the viewport is still one panel in the centre group, under the map tabs.

**Layouts.** One pane, two side by side, two stacked, or four, picked from the view controls or View › Layout. A right click on a pane's label offers what those four allow: Split right and Split down, which split a neighbour too when there's one alongside, and Close pane, or Close row and Close column in four panes. What stays keeps its place, its view and its camera (`PaneChange`). `domain/viewLayout.ts` holds a layout: its kind, where the dividers sit, and what each of the four slots looks along. A slot keeps its view while a smaller layout hides it. A divider drags, highlights under the pointer, stays a tenth of the viewport from the edge, and goes back to the middle on a double click.

A layout is per tab (`TabState.viewLayout`), and remembered per map in `MapPrefs` in `localStorage`, not the sidecar: it's how this machine looks at the map, not part of the map. `followViewLayouts` writes it a moment after a change. Cameras aren't remembered: a map opens framed.

**Projections.** Each pane is Perspective, Top, Bottom, Front, Back, Left or Right, from the menu on its label, View › Active pane or the numpad keys. `domain/orthoView.ts` defines them in game space: Front stands on the +X side (the game's forward) looking back at the map, Right on the +Y side, and Top keeps X up the screen and Y to the right. `coords.ts` takes that to the renderer's frame. An orthographic pane has its axes and scale, `1 px = 2 cm`, on a chip in its bottom left corner.

Changing projection keeps the point the pane looks at and its size on screen. Numpad 5 goes to the orthographic view nearest where the pane looks, or back to perspective from the same direction.

**The view controls** sit in the viewport's top right, over every pane, because what they set is global: how the view divides, the Display popover, the gizmo's axes and snapping. A pane's label in the top row drops beneath them when the two would meet. The Display popover is the one home of Show grid, Show sky, Show water and Map lighting, and of the open map's grid height (`Use player start` puts it back).

**The active pane** is the last one hovered or clicked, outlined when there are several. It is what the fly keys, Focus selection, Frame all and the numpad keys act on, and where a palette piece lands. A pointer drag or the wheel acts on the pane under the pointer, and a drag stays with the pane it started in. Camera speed is global.

**Navigation in an orthographic pane.** The view has one way to look, so look, orbit and pan drags all pan, one to one with the pointer. The wheel zooms to the pointer, whatever it is bound to in perspective. The left, right, up and down keys slide the view, forward and reverse zoom it, and the arrow keys do nothing. Resizing a pane shows more or less of the map at the same zoom.

**The world grid** (`editor/OrthoGrid.tsx`) is a shader over each orthographic pane, drawn over the map at a low opacity so it can be read against a floor that fills the view. It has lines on multiples of their size from the world's origin, which is where snapping puts things: 1 m lines and 10 m sections like the perspective floor grid, fading in 10 cm and 1 cm lines closer in and leaving only the coarser ones further out (`gridLevels`). With snapping on, a step that isn't a power of ten (25 cm) gets lines of its own. The X, Y and Z axes through the origin are in the game's colours. Show grid hides both grids. An orthographic pane has no sky or floor grid: they sit on a layer only perspective cameras see.

**The sky** (`editor/SceneLights.tsx`) of a perspective pane is the map's, hazing out over the far floor into the theme's background. With Show sky off, a gradient from `THEME_SKY_COLORS` takes its place, so neither reads as a flat band above the floor.

**Editing** works the same in every pane: clicks, the gizmos and Alt+drag all sort the pointer by pane and measure it against that pane's camera. The gizmo is placed for each pane just before it draws, so it keeps its size and faces each camera. An axis handle pointing at the camera, and a plane handle or ring seen edge-on, are hidden and can't be grabbed (`handleFacesCamera`), as in Blender. Hover shows only in the pane under the pointer.

**One scene, one context.** `editor/PaneRenderer.tsx` takes over R3F's render and draws each pane into the one `WebGLRenderer` with a viewport and scissor. `editor/paneCameras.ts` holds the cameras, per tab and slot, outside React because they change on every pointer move. The store says what a pane looks along and the cameras follow. Anything that has to face the camera hooks in with `useBeforePaneDraw`.

**Frame cost.** On a large map the CPU's draw calls set the frame time, and four panes drawn every frame would cost four times that. So they aren't:

- The active pane does. The others keep their pixels (`preserveDrawingBuffer`) and take turns, one at a time and at most every 80 ms (`panesToDraw`), which also keeps moving materials moving. During a gizmo drag the other panes follow at that rate.
- Every pane draws when its pixels are gone or in the wrong place: a resize, a moved divider, a changed layout or projection, another tab. Dragging a divider on a large map is therefore the slow case.
- `scene.updateMatrixWorld` runs once a frame, not once a pane, and skips the items: an item's objects work out their matrices when they change (`FixedGroup` in `ItemObject.tsx`). An object that updates its own matrix forces everything under it to update too, so the scene and the items' root keep theirs fixed as well. Code that moves an item outside React has to call `updateMatrix`, as the gizmo does.

### Menus

`components/MenuBar.tsx` holds the menus. Every item calls the entry point its keybind or button uses. A disabled item says why in a tooltip. Shortcuts everywhere are `components/KeyChip.tsx`, one caption chip per chord.

- **File:** New map, New project… (`components/NewProjectDialog.tsx`, a name that becomes `Documents/Ballest Editor/<name>`, shown as it is typed), Open project…, Recent projects, Save, Close tab, Settings… (`components/SettingsDialog.tsx`, a modal in `SettingsShell`'s shape that looks the game up again each time it opens, and is meant to become a window of its own later), and Quit, which closes the window the way its × does, so unsaved edits ask.
- **Edit:** Undo, Redo, Cut, Copy, Paste, Duplicate, Delete, Deselect, Group, Ungroup and Save selection as prefab….
- **View:** four named sections. Camera: Focus selection, Frame all. Panels: the dock's panels and Reset layout (§ Dock), the one place every panel can be toggled. Panes: Layout and Active pane (§ View panes), each submenu headed by a line saying what it does. Grid: Snap to grid, Grid size; Show grid is in the viewport's Display popover.
- **Project:** New map, Import map…, Export to game, Re-import from game; Play, Open game (Steam); Project settings….
- **Help:** Keyboard shortcuts (every keybind by section, the same sections as Settings › Keybinds, in a dialog that stays open; holding Shift+/ shows it only while held), Check for updates, Release notes (the GitHub Releases page), About Ballest Editor (the version with a Copy button, links to the release notes and the repository, and the licence).
- **Web review build:** File (New map, Open…, Save, Export…, Close tab, Settings…), Edit, View, Project (Project settings…, the one map's), and Help without its update rows.

There is no Map or Game menu: the menus act on the active tab's map, and the game is the project's export target. Rename, Duplicate and Backups are per map in the Project panel. The Game link is the user's machine, not the project's, so it is a page of Settings, Settings › Game.

### Project panel

`components/ProjectPanel.tsx` is the Project panel (§ Dock). It lists the project and its maps, the way an editor's file explorer shows a workspace.

- Each row shows the map and its sync status (§ Status bar) as a badge, in the status bar's words and colours. Hovering the badge gives the link state and when the map was last exported, and hovering the name when it was last edited. Both tooltips open below the row, clear of the badge and the ⋮ button.
- A click opens the map.
- Its menu (⋮, or a right-click) holds Open, Rename…, Duplicate…, Backups…, Export to game, Play and Reveal in folder. The ones that act on the open map open it first (`withProjectMapOpen`). Reveal in folder shows the project's maps folder, not the file.
- The header holds the project's name, with its folder on hover, or an Untitled chip in Untitled Project, then New map, Import map and Project settings. Import map is disabled in Untitled Project, and its tooltip says why.
- Every tab whose map has no file yet (a fresh one, any in Untitled Project, what a switch of projects left open) is a row of its own badged Unsaved, above the project's maps. A click makes that tab active.
- A project with no maps has one line and a New map button, centred in the space under those rows. In Untitled Project the header's chip says on hover that saving a map creates the project.
- No thumbnails yet.

### Outline

`components/Outline.tsx` is the map's tree of groups and items, a dock panel that starts on the left (View › Outline, § Dock). It fills whatever it is mounted in and scrolls by itself. `domain/outline.ts` holds its rows, filter, drop targets and scroll window.

- A row shows a chevron if it is a group, a 16px glyph, the name and tag chips. Only the rows in view are drawn.
- Every row's icon is a glyph (`components/outlineGlyphs.ts`): the player start and the goal have their own, an item has its piece category's, else a generic box, and a group has a folder. A tooltip on the name gives an item's class, or the items under a group.
- An item's name is the user's, else its piece's: the catalog's display name, or the class written out where the catalog has none (`MP_PlayerStart` is Player Start; the game places it itself and has no name for it).
- A name used more than once gets an ordinal, muted, right after it: items among themselves in document order, groups in tree order. A name nothing else has shows none. The ordinal isn't part of the name, so renaming starts from the name alone. The status bar shows a group the same way.
- A click selects, as `toggleSelection`'s chord toggles and `addToSelection`'s chord selects the range from the last row clicked. A group row stands for every item under it, and it lights up when all of them are selected. A click on empty space clears the selection.
- A selection made anywhere else scrolls its active row into view once, as far as it takes, and opens the groups around it.
- Double-click or F2 renames in place: Enter commits, Escape cancels, and an empty name puts an item back on its default name. A group always has a name, so an empty one changes nothing.
- A drag moves the selection, or just the row when it isn't selected, as one undo step. A line shows a drop before or after a row, and the row lights up for a drop into a group. A group's top and bottom quarters drop beside it, and the gap under an open group is its first child's. Below the last row is the end of the root.
- Right-click selects the row if it isn't selected, then offers Group, Ungroup, Save selection as prefab…, Enter group, Select all in group, Rename, Duplicate, Delete, Focus and Edit tags, with Update from prefab and Detach from prefab on an instance. An instance's row has an icon of its own. Enter group is for a group's row: it opens the group, clears the selection and enters it. Select all in group selects the row's group, or the group an item's row is in.
- The button beside the filter folds every group, and opens them all once they are folded. It is there when the map has groups, and off while filtering.
- The filter matches names, classes and tags, needing every word. It shows matching rows with the groups around them, whatever is collapsed. A group's items show only if they match too.
- Which groups are collapsed is kept per tab in the store, outside the sidecar and the history, so undo leaves it alone.

### Groups and selection

The groups are the sidecar's ([PROJECTS.md § The files](PROJECTS.md#the-files)), and the game gets what it can hold of them ([FORMAT.md § Groups](FORMAT.md#groups-editorstategroups)). `domain/groupSelection.ts` holds the rules below. The selection stays a list of item keys, so the gizmo, the Inspector, Copy and the rest act on a group's items with no group logic of their own. The item clicked is the active one, so the gizmo sits where the click was.

- **Group** (Ctrl+G) puts the selected items in a new group called Group where the first one was, and a group whole in the selection goes in whole, nested. **Ungroup** (Shift+G) dissolves every group whole in the selection, and the items stay selected. Both are in the Edit menu, the Outline's menu and the keybind settings.
- **A click** on a grouped item in the viewport selects its outermost group, as the game does. The add and toggle chords add or take away that whole group.
- **A double-click** enters the group, and the next click level is its children, an item or a nested group. Another double-click goes one deeper. The Outline's menu enters a group too, since a double-click on an Outline row renames it. The status bar names the entered group, with × to leave it. The Outline marks its row, dims what is outside it, and shows a breadcrumb above the rows: its back arrow steps out as Escape does, and a crumb enters that level, Root leaving altogether. The entered group is kept per tab in the store.
- **Leaving:** Escape steps out one level and selects the group it left. A click on empty space leaves altogether. A click outside the group lands in the nearest parent group that holds what was clicked, or at the root.
- **The box.** Each group whole in the selection has a dashed box around its items in the viewport, in a colour of its own (`editor/groupBox.ts`, `GROUP_BOX_COLORS`), as well as its items' outlines. The entered group keeps a thinner, fainter box while something inside it is selected. The box is drawn over everything. It is the one whose centre a group's frame takes ([FORMAT.md § Groups](FORMAT.md#groups-editorstategroups)), following an edit as it happens, so it goes by the items' bounds and not by the meshes drawn.
- **The Inspector** sums a selection that is exactly one group: its name, tags and the pieces in it. Its items' transform, paint and properties are under a closed disclosure and edit all of them at once. A single selected item shows its tags under its name. Tags are free strings: Enter or a comma adds one, Backspace in the empty field removes the last.
- **Delete** removes the group's items, and the group goes with them. **Duplicate** copies a whole group as a new group of the same name and shape.

### Prefabs

A prefab is a reusable assembly, kept as a file in the game's format ([FORMAT.md § Prefab file](FORMAT.md#prefab-file)). The file is its **definition**, and each placed copy is an **instance**: a group with a link to the definition in the sidecar ([PROJECTS.md § The files](PROJECTS.md#the-files)). `domain/prefab.ts` holds the conversions, `domain/prefabInstance.ts` the instances, `editor/actions/prefabs.ts` and `prefabFollow.ts` the flows, and `project/Prefabs.ts` the files in main.

**Tiers.** User prefabs are the game's own `Saved/SaveGames/Prefabs/`, beside its maps folder, so the in-game editor's `listprefabs` and `spawnprefab` see them and the other way round. Project prefabs are `<project>/prefabs/`. Main writes atomically and only in those two folders. A write over a prefab, a Rename and a Delete keep the old file, and Recover brings a version back (§ Backups). Untitled Project has no project tier. The UI calls them Game and Project (`prefabTierLabel`). The web review build has one tier, "Session", kept in memory until the page closes.

**The panel** (`components/PrefabsPanel.tsx`) lists each tier with a filter box. A row shows the name, the item count and the first piece's thumbnail, or a glyph. A click, or a drag onto the viewport, places the prefab. Its menu (⋮, or a right-click) holds Place in map (Place in prefab on a definition's tab), Open definition, Rename…, Duplicate, Copy to project or Copy to game, Delete… and, on desktop, Reveal, which shows the tier's folder. A file that doesn't read as a prefab is listed, and can only be renamed, copied, deleted or revealed.

**Placing** does what `spawnprefab` does (`spawnFrameOf`): the frame goes on the line through the active pane's camera, far enough along that the items' box starts 500 cm ahead. An orthographic pane has no distance, so the line starts at the middle of its view. The items land selected, as one group named after the prefab, in one undo step. A prefab the game would refuse is refused here with the game's words (`prefabProblems`).

**Save selection as prefab…** (Edit menu, the Outline's menu) is off while the game would refuse the selection, with the game's words in its tooltip. It asks a name and a tier and writes the selected items in selection order, measured from the centre of their turned bounds with no turn or scale, as the game's frame. A selection that is exactly one group gives the file that group's name. It changes nothing in the map, and a name the tier already has turns Save into Replace.

**Instances.** The Outline marks one, and the Inspector shows "Instance of <name>" with how it stands, Update, Detach and Open definition. An instance is **unmodified** while its items match what was placed, allowing for its own placement (`checkInstance`): moving, turning or scaling the whole group, by the editor's scale or the game's, doesn't count. Renaming the group, tagging it and reordering its rows don't either. Changing an item's own transform, properties or materials, or adding or removing one, does. Double-clicking into an instance to edit it is allowed, and makes it modified.

**Following.** Whenever a definition's file changes, every open map follows it: the tab that saved it, or the game, or anything else writing the file. Files are looked at on launch, on focus, after a Play session and after the app's own writes, not by watching the folders (`checkPrefabs`). A map that opens later catches up then.

- An unmodified instance updates in place, as one undo step of its tab, and the tab has unsaved edits. Undoing that isn't taken back by the next look, since only a file that changed sets it off. Items of the same class keep their keys, so names and tags survive.
- A modified instance stays as it is and goes in the notification centre, once per change, with Update, which replaces it where most of its items stand, and Detach, which keeps the group and drops the link. The Inspector offers the same.
- Rename moves the links in open maps. A map opened later finds the definition by its hash, if the file hasn't changed since. A definition that is gone leaves its instances standing, and they say so.

**Definitions open in a tab** (Open definition), with the same viewport, Outline and Inspector. The tab holds a map-like document of the prefab's items, around the default start so it sits above the water, and shows the name and a Game or Project chip. Save writes the file, and instances follow. Unsaved edits ask like a map's. Export and Play are off, with a tooltip. The file has no place for structure, so groups made in the tab aren't saved, and a prefab placed in the tab is a plain group. Untouched items are written back as they came, and an edited item keeps its `paint` until its materials change. A file that changes behind a tab with no edits is read again; with edits, the tab says so and Save writes over it.

**Export.** An instance reaches the game as its items and one group named after the prefab ([FORMAT.md § Groups](FORMAT.md#groups-editorstategroups)). Nothing about prefabs goes in the map's file.

### Game link

`components/GameLink.tsx`, with rows from `domain/gameLink.ts`, is the one place the app describes the game's install, its maps folder, the creator name (`useCreator()`), the plugin manager and the editor plugin. Settings › Game is its home: each row is a settings row with a state icon, its name, a one-line status ("Found", "Not found") and its buttons at the right of the name's line, and Check again is in the page's footer. `components/GameLinkDialog.tsx`, which opens by itself on the first launch or when Export's folders are missing, lists only the missing rows, each with what is wrong, and an Open Settings › Game button.

The install, maps folder and plugin manager rows have Reveal, and a row's info icon holds how it was found and its full path, which the page shows nowhere else. A missing one carries its fix:

- **The install:** Choose folder…, a folder dialog. A folder without the game's exe keeps the row marked missing with main's reason, and nothing is saved.
- **The maps folder,** once the game is found: "Run the game once to create its maps folder" and Choose folder….
- **The editor plugin:** Install or Update (§ Installing the plugin).
- **The creator:** Set name… (Settings › General).

A folder that is there has two icon buttons, each named by its tooltip: Reveal in file manager (a folder) and Choose folder… (a pencil). One chosen that way says "Chosen here", and its row's reset button (↺) looks it up again (`resetGamePaths`). An overridden folder marks the Game category and the row with the "modified" dot, and Reset game to defaults resets every chosen folder.

The plugin manager (`noPluginManager`) is optional, because only Play needs it. Its row is neutral ("Not installed (optional, for Play)") with an Install docs button to its README (`openExternal`), never marked missing. While its plugins folder isn't found, the row also has Choose folder…, for a plugin manager whose plugins folder is somewhere unusual.

Rows that need an earlier one wait for it: the maps folder and the plugin manager need the game, and the plugin needs the plugin manager. A chosen folder is saved as the override, and the other folders and the plugin are looked up again, so the rows update in place. Check again looks everything up again.

The dialog opens by itself when the startup check finds the game or its maps folder missing, which is what Export needs, and on the first launch if any row is missing. With everything found, the first launch shows nothing. A missing plugin manager never opens it.

### Project settings

`components/ProjectSettingsDialog.tsx`, in `SettingsShell`'s shape, has _Project › General_ on the left, then _Maps_ with an entry per map. The map showing has a Workshop page, an indented entry under its own, and that page's heading names the map. Project › Project settings… opens on the project, and the map's settings button in the Inspector (`openDialog({ id: "mapSettings" })`) opens on the open map's entry. The web review build has only the one map's entry.

General has the project's name and its places:

- The name is editable and goes into `ballest-project.json` through `renameProject` (IPC `ballest:project:rename`), and the folder keeps its name. In Untitled Project the field is empty, and typing a name names the project (`nameProject`), as the Save dialog does.
- The places show their folder's name, with the path on hover, and a Reveal (`revealProject`, IPC `ballest:project:reveal` with `which`): the project folder, with Open another project… beside it; its `maps/`; its `.ballest/backups/`. In Untitled Project one row reads "Created when the project is named" in place of these. The game's maps folder, where exports go, has a Reveal too (`revealGamePath`).

A map's Map page has the name, the file (its name, the path on hover, Reveal and Copy path) and Export on save. Its Workshop page has the difficulty and tags, and hovering a difficulty says how the game draws it. The Name field is how a map is renamed here, and it refuses a name the project has. The entry of a map open in a tab, active or not, edits that tab's document (undo steps there, saved when the tab is) and its prefs. A map not open anywhere is read from its file when its entry shows and edited on disk through the save path (`patchProjectMapEffect`: read, patch, `saveMap`, or `renameMap` when the name changed, so the old file goes to the backups), along with the prefs kept for it, and a rename carries the prefs and the entry to the new file.

### Status bar

The status bar runs along the bottom. The project is the window's title, centred in the top bar, with the document tab's dot while a tab has unsaved edits or the project is Untitled Project. The top bar's right end has Play.

- On the left: what a check for updates is doing, and the entered group.
- In the middle: the open map's sync status and when it was last exported, as a coloured chip. Its popover's title is the status, then the link state when that adds something (which side changed, or what stands behind Unsaved), the last export's time, Reveal, Export and Play. A map with no file shows "Not saved in the project yet".
- On the right: the update pill and the notification bell.

The link states are Not exported, In sync, Edited since export, Changed in game, Both changed and Published draft. A map's state comes from `listMaps`: each `ProjectMap` carries the SHA-256 of its file, compared with `link.export.hash`, and its `publishedFileId`, the project file's `levelPublishedFileId`, read once per file version (main caches them by time, size and inode). Changed in game comes from the link: its `lastSeenHash` differs from `export.hash`. It's Both changed when the project map was saved or has unsaved edits since the export. A change in the game outranks Published draft, which outranks the project side, so a published draft with edits never shows Edited since export. The popover adds Re-import in the two changed states.

The sync status (`syncStatusOf` in `domain/linkState.ts`) is what the chip, its popover and the Project panel's rows show: a link state with the unsaved edits folded in. Unsaved is any map whose tab has unsaved edits, whatever its link state. Otherwise it's Not exported, In sync, Changed since export (Edited since export, Changed in game and Both changed) or Published draft. [ui-system.md § Status colours](design/ui-system.md#status-colours) has their colours.

### Notifications

The store's `notify(level, title, { kind, body, persistent, actions })` makes a `NotificationRecord` (`@ballest/contracts`) and sends it to one of two places, never both (`belongsInInbox` in `domain/notifications.ts`):

- **A notification** is for what happened in the background or has to wait for the user: a pinned one, a game link change, a map changed in the game, a prefab changed on disk, editor data that didn't match. It goes to the notification centre without a toast, and the bell counts it.
- **A toast** is immediate feedback on what the user just did, including failures, refusals and validation messages: Saved, Exported, "Select 2 to 4096 items before saving a prefab." Every kind is a toast unless it is pinned or listed in `INBOX_KINDS`. `showToasts` hands each one to `components/Toasts.tsx`, with its first action as the button, and it isn't kept. An error stays up for 8 seconds.

Both show a message through one row (`components/NoticeRow.tsx`): icon, text, time, and Reveal as an icon button.

- Actions are data (`NotificationCommand`: `RevealProject`, `RevealGamePath`, `ChooseGamePath`, `OpenMap`, `OpenExternal`, `InstallPlugin`, `ReimportMap`, `UpdatePrefabInstances`, `DetachPrefabInstances`, `Dismiss`), so they still work after a restart. `runNotificationCommand` runs them.
- The bell lists them newest first, grouped by day, the unread ones counted. A `persistent` one is pinned to the top until `resolveNotifications(kind)`, and a newer one of its kind replaces it. Mark all read; Clear keeps only the pinned.
- The last 100 are kept in `<userData>/notifications.json` (`NotificationLog` in main, `loadNotifications` / `saveNotifications` over IPC). One entry that doesn't decode is dropped, not the file. A browser keeps them in memory.

**Game link notifications.** At startup the page looks up the folders and the plugin (`checkGameLinkEffect`) and compares whether the game and the plugin manager are found with what the last launch found, kept in `desktop-settings.json` (`gameLink.last`, IPC `ballest:gameLink:memory` / `ballest:gameLink:remember`). Only a change is notified: the game lost (`gameNotFound`, persistent, Choose folder…) or found again (`gameFound`), and while the game stays, the plugin manager gone (`pluginManagerMissing`, persistent, Install steps) or back (`pluginManagerFound`). Play reports a missing game or plugin manager under the same two kinds (§ Play).

The first launch notifies nothing: the dialog says what is missing. A persistent one resolves itself as soon as a lookup finds its cause gone (at startup, or after Choose folder…, reset or Install in this session), and that lookup's result is kept, so a fix made in the editor isn't announced again on the next launch. These kinds offer Don't show again: the kind goes into `desktop-settings.json` (`notifications.muted`, IPC `ballest:notifications:mute`), its notifications leave the list, and `notify` drops new ones.

### Backups

Every write over an existing map file or sidecar goes through one step, `Backups.overwrite` (`apps/desktop/src/project/Backups.ts`): the old bytes are kept in a backups folder, the new ones are written atomically, and that folder is pruned. Save, Duplicate over a map, Import replacing a map, Export to game, Play's export, Re-import and the Export confirm's Back up and overwrite (§ Sync) all use it. Rename moves the old file into the backups instead (`Backups.retire`), and so does anything that leaves a sidecar without its map.

- **Where.** The project's own files go to `<project>/.ballest/backups/`. The files Export writes over in the game's maps folder go to `<userData>/backups/`, which is the app's: a project can be shared, but the game's copy of a map is this machine's. Both folders are flat: `<time> <file name>`, the time in ISO 8601 UTC with `-` for `:` and `.` (`2026-10-31T12-00-00-000Z Map_LevelEditorMain&Big Loop_Isaac.balledit`). Two backups of a file in the same millisecond get consecutive times, so names never collide and their order holds.
- **Skipped** when the new bytes are the old ones (nothing is written either), or when the newest backup of that file already holds the old bytes. A backup that fails stops the write, so the old file is never lost to a failed copy.
- **Prefabs** are kept the same way, the project's in its backups and the game's in `<userData>/backups/`. A Rename and a Delete move the old file there.
- **Sidecars** are kept beside the maps in `<project>/.ballest/backups/` under their own file names, and Recover lists only the maps. Reading a project backup also gives the sidecar kept for it, which is the oldest one kept since, because a Save backs up the map first and its sidecar right after. A version with no such sidecar, and any of the game's copies, gets the map's sidecar as it is now. The page re-matches a sidecar that wasn't written for those bytes, as on any open.
- **Retention.** After each write the folder keeps the newest 20 versions of each file and drops any older than 30 days. `desktop-settings.json` can change both: `{ "backups": { "keep": 20, "maxAgeDays": 30 } }` (no UI yet). Git history (#105) is the long-term version history; this is the safety net.
- **Recover** (the Project panel › a map's menu › Backups…) shows the open map's versions, newest first, and a segmented control's All backups for everything else: other maps, including ones no longer in the project, then User prefabs and Project prefabs, including ones renamed or deleted since. Main lists both folders (`listBackups`, `listPrefabBackups`) and reads a backup by its place or tier and its name (`readBackup`, `describePrefabBackup`), refusing any name it didn't write, so paths stay in main. A map's version shows its time, whose copy it is (Project or Game) and, decoded through `MapFile` as Open would, its item count and map name. A prefab's shows its time and item count.
- **Opening a version** shows it in the map's tab when one has it open, asking about that tab's unsaved edits first (§ Window; the prompt's Save goes through the backups like any Save), else in a new tab. It loads as unsaved edits of the project map of that file name, so Save writes it over that map, backing up the current file first. A map no longer in the project opens as a new one, and Save names it.
- **Restoring a prefab's version** (`restorePrefabBackup`) writes its bytes back under its name in its tier at once, through `Backups.overwrite`, so the current file is kept first and a restore can itself be recovered. It brings back a deleted prefab, and a version that doesn't read as a prefab can't be restored. Then `checkPrefabs` runs as after any write of the app's own (§ Prefabs).
- **Maps the game changes on its own** (the in-game editor saving into `UserSavedMaps`) are not snapshotted. The editor only loses a game edit when Export writes over it, and that copy is kept. Watching the folder would back up every in-game save, since the game rewrites `editorState` each time, for little gain. Sync detection reports those edits instead.

### Sync

The in-game editor can save over an export at any time ([PROJECTS.md § Sync](PROJECTS.md#sync-edits-made-out-of-band); #141).

- **When.** The page checks at launch (`loadPlatform`), whenever the window gets the focus (`window` `focus`), and when Play's game session ends (§ Play). `checkExportsEffect` in `editor/actions` runs one check at a time: one asked for while another runs waits for it instead of looking again. The game closing brings both the focus and the end of Play's session, so this matters.
- **What main does** (`MapExports.checkExports`, IPC `ballest:project:checkExports`). For each link in the project in use whose export is the map's file in the game's maps folder, main hashes the file (cached by time, size and inode, like `listMaps`) and applies `seeExport` (`apps/desktop/src/project/sync.ts`). Comparison is by bytes, and nothing is normalised, so the game rewriting `editorState` on its own save counts as a change.
  - The same hash as `lastSeenHash` is nothing new.
  - Another hash is kept in `lastSeenHash` and reported as `changed`, unless it is `export.hash` again. So a version is reported once, however many checks see it.
  - A missing file drops `export` and `lastSeenHash` and is reported as `missing`. There's no notification; the map just shows Not exported.
  - An export elsewhere is skipped: one from before the maps folder moved, or one under a map's old name after a Rename.
  - Nothing is checked, or dropped, while the maps folder isn't there (the game not found, a library drive unmounted). A file that can't be read just now is skipped and logged.
  - Each update is made against the link as it is when written, under `MapLinks`' lock, and checks run one at a time (a semaphore), so two never report one change.
- **What the page does.** It lists the maps again, so the status bar and the Project panel show Changed in game or Both changed, and notifies each `changed` map once: "Big Loop was changed in the game" (kind `changedInGame`, not pinned) with Re-import (`ReimportMap`) and Ignore (`Dismiss`). Ignore only marks it read. The state stays until a Re-import or an Export settles it.
- **Export confirm.** `exportMap` and `play` take `overwriteChanged` beside `replacePublished`. Without it, main compares the game's file with the link's export first and answers `ChangedInGame`, writing nothing, when the game changed it and it isn't the bytes about to be written. It marks that version seen, so the next focus doesn't report it again. The page shows the overwriteChanged dialog (`OverwriteChangedDialog`): Back up and overwrite runs Export or Play again with `overwriteChanged`, so the game's version goes to `<userData>/backups/`; Re-import first re-imports and exports nothing; Cancel. Export on save asks the same. A published map's draft is asked about first, and its answer is kept for the second question.
- **Re-import** (`MapExports.reimportMap`, IPC `ballest:project:reimportMap`; from the notification, the status bar popover, or Project › Re-import from game). When the map is open in a tab, that tab is made active, and with unsaved edits the unsaved-changes prompt asks first ("…before re-importing it from the game?"). Main reads the export (only the map's own file in the game's maps folder; a map without one is refused), writes its bytes over the project map through `Backups.overwrite`, which sends the project's version to `<project>/.ballest/backups/`, and records it as the export and as seen, so the map is In sync. The sidecar stays where it is, and the page re-matches it against the new bytes and writes it back whether or not the map is open ([PROJECTS.md § The files](PROJECTS.md#the-files)). It reloads the map in its tab if it is open, and the toast says where the previous version went.

Main touches map files only inside the project's `maps/` and `.ballest/` folders, in the game's maps folder and in `<userData>/backups/`, named by file name, never by path. Import reads a file the user picked in its open dialog.

### Window

The page's top bar is the window's title bar. The window has `titleBarStyle: "hidden"` and a `titleBarOverlay`: Electron draws only the window controls, over one end of the top bar, on the side the desktop puts them (GTK's button layout on Linux). The top bar is a drag region (`-webkit-app-region: drag`, buttons `no-drag`) and pads itself clear of the controls with `env(titlebar-area-x/width)`, which a browser leaves undefined. The page reports its resolved theme (`setWindowTheme`) and main recolours the controls and the window background to match. Same approach as t3-code's.

The window and taskbar icon is `dist-electron/icon.png`, which apps/desktop's build renders from `resources/icon.svg` (256 px, with `@resvg/resvg-js`) and `DesktopEnvironment.iconPath` points at; the window's `icon` option sets it. Linux takes it from there (X11's `_NET_WM_ICON`); Windows shows the exe's icon, which tools/release renders from the same SVG. `productName` ("Ballest Editor") is set in the packaged app's `package.json` (tools/release `config.ts`); unpackaged runs keep the workspace name, so they keep a profile of their own.

**Unsaved changes.** One prompt per map, Save / Don't save / Cancel, guards everything that would lose a map's edits. The page words it ("Save the changes to Big Loop before closing?", `domain/unsaved.ts`) and `Platform.confirmUnsaved` shows it: on desktop a native message box modal to the window (IPC `ballest:window:confirmUnsaved`, `ElectronDialog.showMessageBox`; Escape is Cancel), in a browser a `confirm` whose OK is Don't save. `editor/actions`' `unlessCancelled(action, next)` asks about the active tab only while its map is dirty: Save runs the editor's Save and goes on once it has written the file (a map with no file yet opens the Save map dialog first, and goes on when that saves; its Cancel, or a failed save, stops there), Don't save goes on, Cancel stops. Closing a tab, and replacing a map open in a tab (`unlessCancelledFor`: Re-import, Recover, Import's Replace), make that tab active and ask about it. Closing the window, reloading and leaving a named project ask about every tab with unsaved edits in turn (`unlessAnyCancelled`), making each active to ask; the first Cancel stops there.

**Switching projects** in a window (New project…, Open project… or Recent projects, answered This window) prompts only when a map with unsaved edits would be lost:

| The window is    | It asks                                                                                   | The open maps                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Untitled Project | nothing, ever: no map is left behind                                                      | stay open as unsaved tabs, and Save puts them in the project                                                         |
| a named project  | Save / Don't save / Cancel for each tab with unsaved edits, and nothing when none has any | stay open, unsaved, in the new project. The prompt's Save writes each into the project being left, before the switch |

Either way a blank tab (§ Document tabs) is dropped without a word, and when only blank tabs are open the window starts on the project as a launch does.

Closing and reloading go through the page's `beforeunload`, which cancels the unload while any tab has unsaved edits. A browser then shows its own leave-page dialog. In the desktop app the window stays open: main sees `will-prevent-unload` and sends `ballest:window:unloadRequest` with `"close"` (when the window's `close` event came first: the close button, Alt+F4, Ctrl+Q, quitting) or `"reload"` (Ctrl+R in an unpackaged build, a Vite full reload in dev). The page asks, and unless the user cancels it stops holding the unload and closes (`window.close()`) or reloads itself. Restarting from the update pill doesn't ask again: the pill already says unsaved changes are lost.

Installed builds have no application menu (`Menu.setApplicationMenu(null)`): the page's menu bar is the UI, and Electron's default menu would reload or close the window behind the editor's back. Its Close Window is on Ctrl+W, which is two fly keys held together, and a hidden menu's accelerators still fire. Main handles the two window shortcuts it would have given, F11 (fullscreen) and Ctrl+Q (quit), in `before-input-event`. Unpackaged builds replace the default menu with a hidden one that has only Reload, Force Reload and Toggle DevTools (`devMenuTemplate`). Ctrl+W reaches the page in both: `before-input-event` must not `preventDefault` it, or the page loses the keydown and the camera stops flying. Alt+F4 and window snapping come from the OS, not the menu.

### Other windows

Each editor window is a running copy of the app, a process of its own. There is no single-instance lock and no second editor window inside a process, because `Projects` and the other services hold one window's state. A panel popped out into a window of its own (§ Dock) is part of its editor window. The rule is one project per window, and one window per project.

**The registry.** `WindowRegistry` (`apps/desktop/src/project/WindowRegistry.ts`) keeps a file per running copy, `<userData>/windows/<pid>.json`: `{ "pid", "project", "choosing" }`. `project` is the folder, or null for Untitled Project. `choosing` is true while the required chooser is up, which holds no project and isn't Untitled Project. A copy writes its file at start and on every project change, and removes it on quit.

A copy that crashed leaves its file behind. Whoever reads the folder next tests the pid (`process.kill(pid, 0)`, which also works on Windows) and removes the file of a pid that's gone, along with anything that doesn't decode. EPERM counts as running: that's another account's process, such as an elevated copy, and a project held by mistake does less harm than two windows writing the same files. A reused pid reads as a live window until that process ends, and the project stays refused until then. A registry write that fails is only logged.

**Where a window starts** (`decideStart`, `project/windowStart.ts`).

| The window has | And                                      | It starts on                          |
| -------------- | ---------------------------------------- | ------------------------------------- |
| a `--project`  | no other window has that project         | that project, with no chooser         |
| a `--project`  | another window has that project          | the chooser                           |
| no `--project` | another window is on Untitled Project    | the chooser                           |
| no `--project` | another window has the last project used | the chooser                           |
| no `--project` | neither                                  | the last project, or Untitled Project |

A refused `--project` (§ New window) counts as none, and the page shows the reason (`ProjectState.startRefused`).

Two copies started in the same moment can each look before the other has written its file. So a copy looks, writes its file, then looks again at the lower pids only: the lower pid keeps what they both took, and the higher one shows the chooser.

**The chooser** (`components/ProjectChooser.tsx`) is the start screen: it takes the whole window, in the editor's place, while `ProjectState.chooserRequired` is true, from main's decision until a project is in use. It follows [mockups/welcome.html](mockups/welcome.html) § 1 without the thumbnails, centred in the window. A band across the top has the logo, the product's name, and New project and Open project… side by side. Under it, the left column has the recent projects as rows of name and last opened (`RecentProject.lastOpened`, kept in `project.lastOpened`), with the full path and the exact time in a tooltip. A row shows its parent folder only when another recent project has the same name. The right column has the version and a link to the release notes. A click opens a project here; a row's "…" has Open in new window, Reveal and Remove from recent (IPC `ballest:project:revealRecent` and `ballest:project:forgetRecent`). A project open in another window says so and can't be picked. With no recent projects it opens on the name prompt. New project asks for a name and shows where its folder goes, with Change… to pick another. A pick always goes to this window and then opens the project's map as a launch would.

There is nothing to dismiss, and the window's own close button is the way out. `ProjectState.current` stays null meanwhile, so main refuses to write a map. The dock isn't mounted, so there is no scene behind the screen. Main adds `?chooser` to such a window's URL, so its first frame is the start screen's, not the editor's skeleton (`startsOnChooser`). The store opens no other dialog while it's up, so a Game link check that would open one does nothing, and the editor's keys are off (`isModalOpen`). The list updates whenever the window gets the focus (§ Sync's check lists the project again).

**Opening a project.** New project… (once it has a name), Open project… (once a folder is picked) and a recent project go through `openProjectEffect` in `editor/actions`, whatever the window holds:

1. Main checks the project first (`Projects.check`, IPC `ballest:project:check`) and nothing is written. A project open in another window is refused with `openElsewhere`, which says to close it there first. `Projects.use` refuses it again, so the check can't be got round. The game's maps folder and a name already taken are refused here too. A refusal lists the project again, so a stale row updates. Recent projects marks a project open elsewhere, and picking it shows the refusal.
2. It opens in this window. The whereToOpen dialog asks first (Cancel, This window, and New window as the primary action) only while this window has unsaved changes, because that's when New window saves a prompt. The required chooser never asks: its pick is this window's start. Always do this keeps the answer in `general.projectOpensIn`, and Settings › General › Open projects in puts it back to Ask if unsaved. Shift+click on File › Recent projects, and Open in new window on a start screen row, go straight to step 3's New window.
3. **This window** is `changeProject`: [§ Window](#window) says what it prompts and what becomes of the open maps. **New window** starts a copy (below) and leaves this window as it is. **Cancel** does nothing.

A new project's folder is made only after This window or New window, and after any unsaved-changes prompt, so Cancel at any of those leaves nothing on disk.

**New window** (`WindowLauncher`, `apps/desktop/src/window/WindowLauncher.ts`; IPC `ballest:project:openWindow`). Main makes a new project's folder, then starts a detached copy with `--project=<path>`, and this window stays exactly as it is. The new copy adds the project to the recent ones when it starts.

| The app runs as                                     | The new copy is                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Windows, installed                                  | `process.execPath`                                                                          |
| Linux AppImage                                      | `APPIMAGE`, the AppImage's own file. The mount it runs from goes when the first copy exits. |
| Unpackaged (`pnpm dev:desktop`, the `start` script) | Electron with the app's folder. The dev runner doesn't follow it, so it outlives Ctrl+C.    |

A new copy keeps the flags this one was started with, since some Linux desktops need `--no-sandbox` to run an AppImage, except `--remote-debugging-port`, which only one process can hold. A copy that can't be started is `WindowLaunchError`, shown as an error. That covers failing to start at all: a copy that starts and dies at once isn't noticed.

NixOS runs an AppImage through `appimage-run`, whose `bwrap` has `--die-with-parent`. There the new copy's sandbox is a child of the first copy, so closing the first copy kills the new one, unsaved edits included. Only that wrapper does this.

`--project` works from a terminal too. Main takes it only if it's an absolute path to a folder that exists, outside the game's maps folder.

## Main process

The main process is an Effect program with one service per Electron API. [apps/desktop/README.md](../apps/desktop/README.md) describes how it starts, how the page talks to it, its services, its protocol handler, the preload and its security settings, and how to add a method the page can call.

## Game paths

[FORMAT.md § Where files live](FORMAT.md#where-files-live) lists the install, maps and plugins folders on Windows and under Proton. `apps/desktop/src/game/` finds them without configuration:

- **Steam's folder.** Windows: the registry (`HKCU\Software\Valve\Steam` `SteamPath`, then `HKLM` `InstallPath`), then `%ProgramFiles(x86)%\Steam` and `%ProgramFiles%\Steam`. Linux: `~/.local/share/Steam`, `~/.steam/steam`, `~/.steam/root`, the Flatpak (`~/.var/app/com.valvesoftware.Steam/.local/share/Steam`) and the Snap. Folders that resolve to the same place count once.
- **The game.** Every library `steamapps/libraryfolders.vdf` lists (current and pre-2021 formats); the first with `steamapps/appmanifest_3339810.acf` whose `installdir` holds `Ballest/Binaries/Win64/Ballest-Win64-Shipping.exe`. The same algorithm as the plugin manager's `tools/find_game.sh`.
- **Maps.** Found when the game's `Ballest/Saved` folder exists, which the game makes on its first run. Export to game creates `UserSavedMaps` in it if the in-game editor never saved a map. Under Proton the prefix is looked for in the game's library first, then in every other library.
- **Plugins.** Found when the folder exists, which means the plugin manager is installed.
- **Running.** Windows: `tasklist` for `Ballest-Win64-Shipping.exe`. Linux: a `/proc/*/cmdline` naming that exe, since Proton runs it as an argument and the process name doesn't match.
- **Creator.** The game writes the Steam persona name into every map's `creatorName` and file name, so `GameCreator` reads it from `<steam>/config/loginusers.vdf` in each of Steam's own folders, the same ones as above, registry included: the user with `MostRecent "1"`, else the newest `Timestamp` (Steam on Linux writes no `MostRecent`). Without a login file, it takes the creator most `.balledit` file names in the maps folder end in.

The renderer gets the creator as `{ name, source: "steam" | "mapsFolder" }` or null (`findCreator`), unchecked. Settings › General › Creator name shows it ("From Steam") until the user types another name, which then sticks, and "Use Steam name" goes back. A found name with characters a map file name can't hold isn't used, and the row says why. `domain/creator.ts`'s `creatorOf` combines the setting and the found name into `{ name, source: "steam" | "mapsFolder" | "user" | "none", valid }`, the shape the Game link's creator row shows.

The renderer gets each folder as `found | overridden | missing`, with the path it is or would be at. Overrides live in `desktop-settings.json` under `game`. Overriding the install moves the plugins folder with it unless that is overridden too. On Linux the maps folder is then looked for in the chosen install's library first, when the path has Steam's shape. On Windows it stays under `%LOCALAPPDATA%`.

The app never touches the install except the plugin's own folder and a staging folder beside it (§ Installing the plugin), and only through `GameLink`.

## Play: the plugin handoff

The [Ballest plugin manager](https://anythinggoes-ballest.github.io/ballest-plugin-manager/) runs AngelScript plugins inside the game. Its host already has what Play needs, so nothing had to be merged upstream:

- `Tracks::OpenLocal(name)` races a never-published `.balledit` from the maps folder as a normal race (pre-race menu, countdown, checkpoints, finish). The file is re-read on every entry, so pressing Play again picks up edits.
- `Plugins::ReadFile(path)` reads a file from the plugin's own folder, fresh each call.

So **Play** (the top bar's Play button, Project › Play, the status bar popover, F5) is Export to game followed by the handoff. The page saves unsaved edits first (a map with no file yet is named first, then played), then calls `Platform.play` (IPC `ballest:game:play`, `{ fileName, replacePublished, overwriteChanged }`), and main's `GamePlay.play`:

1. Refuses a project map whose own `levelPublishedFileId` is above -1 (`PublishedMap`), because the host races only maps never published. The page checks this before saving too, and offers Play a new draft: the Duplicate dialog saves a copy under a new name with `levelPublishedFileId` -1 (`asNewDraft`), then Play races the copy. The published map's draft is left as it is.
2. Exports the map with `MapExports.exportMap`, the same step as Export to game: the game's old copy goes to `<userData>/backups/`, and the export's hash and time go into `link.json`. A published map's draft in the maps folder under that name stops it there (`Published`). The page shows the same Replace dialog as Export, and its Replace goes on with Play.
3. Writes `<plugins>/ballest-editor-link/play.json` (`GameLink.requestRace`), atomically: a temp file renamed over it. Only into an installed plugin (`current` or `outdated`), so Play never makes the plugin's folder. The [plugin's README](../packages/ballest-editor-link/README.md#playjson) has the format. The nonce is the time in ms, never the same twice in a row.
4. If the game isn't running (no `Ballest-Win64-Shipping.exe` process), opens `steam://rungameid/3339810`.

It answers `Played` with the export, the link, the plugin's status, whether `play.json` was written (`sent`) and `launch` (`running`, `launched`, or `failed` when Steam couldn't be asked). The page tells the outcome:

- "Racing Big Loop in the game" or "Starting the game to race Big Loop". An `outdated` plugin adds Update plugin.
- `failed`: an error, "Exported Big Loop, but couldn't ask Steam to start the game. Is Steam running?"
- When the plugin couldn't be reached, a toast that says Play can't race the map, and a pinned notification that names the cause (`playWithoutPluginNotice` in `domain/gameLink.ts`). A missing game or plugin manager uses the Game link's own kinds (`gameNotFound` with Choose folder…, `pluginManagerMissing` with Install steps), so there is one pinned notification per cause whether the startup check or Play found it, and the Game link resolves it once the cause is gone. Only a missing plugin is Play's own kind, `pluginMissing` ("Exported Big Loop and started the game. Install the editor's plugin and Play races it for you", with Install plugin), and installing the plugin resolves it.

A Play that reaches the plugin resolves all three. All three offer Don't show again.

The editor plugin polls `play.json` and races a new nonce. Its [README](../packages/ballest-editor-link/README.md) describes what it does.

**The game session.** After a Play that found the game running or launched it, `GamePlay` follows the game's process (every 5 s; a game that doesn't show up within 5 minutes is no session) and, when it exits, publishes `{ fileName, endedAt }` on `GamePlay.sessionEnds` and sends it to the page (`ballest:game:playSessionEnded`, `Platform.playSessionEnds`). One session is followed at a time, and `fileName` is the last map Play raced in it. The page then checks the exports (`followPlaySessions` in `editor/actions`, § Sync).

### Installing the plugin

The editor plugin isn't on the plugin manager's registry. The app ships it and installs it when the user asks.

- **Shipped.** The package's `build` (`scripts/stage.ts`) copies `info.toml` and the scripts its `[script] files` lists into `dist/ballest-editor-link/`, and the desktop app's build and dev tasks depend on it in turbo. `tools/release` stages that folder as `plugins/ballest-editor-link`, which electron-builder ships beside `app.asar` (`extraResources`). `DesktopEnvironment.pluginDir` is `resources/plugins/ballest-editor-link` when packaged, the package's `dist/` otherwise.
- **Status** (`GameLink.pluginStatus`, IPC `ballest:game:pluginStatus`) is read the way the plugin manager's host reads manifests: the same TOML subset, `version` defaulting to 0.0.0, and its `CompareVersions` (dot-separated numbers, a missing one counting as 0).

  | Status            | When                                                                                 |
  | ----------------- | ------------------------------------------------------------------------------------ |
  | `noGame`          | the install wasn't found                                                             |
  | `noPluginManager` | no `version.dll` next to `Ballest-Win64-Shipping.exe`, or no plugins folder          |
  | `missing`         | no `<plugins>/ballest-editor-link/info.toml`, or a file the app's copy has is absent |
  | `outdated`        | the installed `[meta] version` is older than the app's copy                          |
  | `current`         | as new or newer (a newer one, say a developer's, is left alone)                      |

- **Install** (`GameLink.installPlugin`, IPC `ballest:game:installPlugin`) runs only on the user's click, and `noGame` or `noPluginManager` refuses it with a `noPluginManager` error. The files are copied into a temporary `.ballest-editor-link-*` folder beside the plugin (same drive; the host skips folders starting with a dot), and each is renamed over its old copy, `info.toml` last, so a folder left half-updated still reads as the old version. Anything else in the plugin's folder, `play.json` included, stays. The plugin's last nonce lives in the plugin manager's storage, outside the folder. Nothing else in the install is written. The plugin manager loads a folder copied in by hand only when the game starts, so the result says whether the game is running and the editor says "Restart the game to use Play".
- **UI.** The Game link shows `Platform.pluginStatus` as two rows: the plugin manager (with Install docs when it is missing) and the Editor plugin, with its folder, its version and Install or Update.

Later: an `Editor::OpenLocal` host API for "open in the in-game editor", and a file-changed callback instead of polling. Both are upstream requests, not blockers.

## Assets

The extractor's output can't be rebuilt on CI, because that needs the game. So the compressed tree is published as the asset pack, which builds download when the raw files aren't on disk, and contributors without the game can build. [tools/compress/README.md](../tools/compress/README.md) has the details. Every asset is at `/assets/*` on both platforms (`assetUrl.ts`), and the protocol handler maps that on desktop.

## Packaging and release

[tools/release/README.md](../tools/release/README.md) covers how `pnpm dist:desktop:win|linux` packages the app and how a `v*.*.*` tag publishes it. The decisions behind it:

- **electron-builder**, driven by a generated `package.json` whose `build` block is the config, so it can vary by platform, and later by channel and signing.
- **Targets.** Windows NSIS x64 (the players) and Linux AppImage x64 (Proton users). No macOS, because the game isn't on it. The AppImage has no version in its name, so an update replaces it in place.
- **Updates.** The app uses `electron-updater` against GitHub Releases (`apps/desktop/src/updates/`; [how it works](../apps/desktop/README.md#updates)). Nothing downloads or installs unasked: `autoDownload` and `autoInstallOnAppQuit` are off. A pill at the right of the status bar, beside the bell, goes from a quiet "Update" (an arrow with a dot) to a progress ring with the percentage while it downloads, and to an accented "Restart to update" once the release is on disk. Its tooltip names the version. Its popover opens upward: "What's new", the version, the release date and the running version, the release notes in a scroll area, then View on GitHub and Download or Restart, always in view. Links open in the browser through `openExternal`.
- **Signing.** Builds are unsigned so far, and SmartScreen warns on Windows. Signing is #77: SignPath's OSS program or Azure Trusted Signing, done in the Windows job with env-gated secrets so fork PRs never see them.
- **Web review build.** Vercel deploys it for every pull request (a preview URL) and for `main` (production), so a change can be tried without installing anything.
- **CI.** `.github/workflows/ci.yml` runs `pnpm check:everything` on Linux for every pull request and for `main`. That builds the bundles but never packages or launches the app. A desktop build on Linux and Windows runners with a launch under Xvfb is still to come (#69). Until then, `pnpm release:smoke` runs in the release workflow before packaging, and locally when packaging changes. [apps/desktop/README.md](../apps/desktop/README.md#running-without-a-gpu) notes what that launch has to handle.

## Dev workflow

`pnpm dev` runs the web review build. `pnpm dev:desktop` runs the desktop app. [apps/desktop/README.md](../apps/desktop/README.md#develop) has the details.

## What differed from the plan

- **Order of work.** The asset pack, the plugin and packaging all landed before the `Platform` service and native open and save. Game paths came next, and Play last.
- **Projects replaced native open and save.** They were built, then replaced: Save writes the project file, Open became Import, and Save as became Rename and Duplicate.
- **Save to game became Export to game.** It's a byte-for-byte copy of the project file, recorded in `link.json`, with the published-draft and changed-in-game confirms.
- **The plugin stayed in this repository.** The plan had it in a repository of its own, for the plugin manager's registry. It's unregistered instead, ships in the app and installs on a click.
- **Play grew.** It refuses published maps and offers a new draft, and it follows the game session.
- **Added with no plan entry.** Backups and Recover, sync detection and Re-import, tabs, the Project panel and status bar, the notification centre, the Game link checklist, the creator lookup, the unsaved-changes prompts, the custom title bar and the removed application menu, and per-worktree dev ports.
- **Tried, then dropped.** A Start tab, a checklist on it, a Maps dialog, and Map and Game menus. The Project panel, the Game link dialog and the Project menu took their place.
- **IPC** went from one `makeIpcMethod` call per method, each naming its schemas, to the method table in `@ballest/contracts`.
- **The update UI** moved from the menu bar to a status-bar pill with rendered release notes.
- **Packaging** stages no `node_modules`: the bundles inline their dependencies.
- **The PR smoke test** under Xvfb wasn't built (#69). `pnpm release:smoke` runs in the release workflow instead.
- **The web review build** also deploys `main`, not only pull requests.

## Before the public launch (milestone 0.3)

These are tracked as issues, and the details are there.

- #73: confirm redistribution rights for the asset pack and for the Workshop maps in `samples/`.
- #74: fork-safe CI and branch rules.
- #75: `CONTRIBUTING.md`, issue templates, `SECURITY.md`, `CODEOWNERS`.
- #77: code signing.
- #110: the quiet public switch and the Vercel reconnect.
