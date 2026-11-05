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
| Launch game, Play  | hidden              | `steam://rungameid/3339810`, plugin handoff                  |
| Open external link | `window.open`       | `shell.openExternal`                                         |
| Updates            | none                | electron-updater state stream                                |

`Platform.layer` is picked at module load: `window.ballest !== undefined` means desktop. The preload runs before any page script, so that test is reliable. Components still reach it through `editor/actions`. Settings, keybinds and map prefs stay in `localStorage`, which Electron persists under `userData`.

The web review build has no project. Its maps live in tabs in memory: Open is the file input, and Save and Export download the file.

### Projects and maps

On desktop the maps live in a project folder ([PROJECTS.md](PROJECTS.md)). File › New project… or the first Save makes one at `Documents/Ballest Editor/<name>` (`Projects.createNew`, IPC `ballest:project:create`). File › Open project… chooses any folder, and the recent ones are under File › Recent projects.

Until one is used, the window is **Untitled Project \***: `ProjectState.current` is null, nothing is on disk, main refuses to write a map (`noProject`), and the Save dialog asks the project's name first. The game's maps folder, or a folder inside it, is refused with the reason: the game scans its subfolders and rewrites what it finds.

- **New map** asks for the name and, when there's no usable creator, the creator. It saves the map into the project at once; in Untitled Project it stays in memory. The dialog shows the file name it exports as.
- **Save** (Ctrl+S) writes the project file and asks nothing. A map that has no file yet is named first. After the name or creator changed, Save moves the file to the new name and the old one goes to `<project>/.ballest/backups/`.
- **Rename** and **Duplicate** (a map's menu in the Project panel) replace Save as. Rename changes the name or creator and moves the file. Duplicate saves a copy under a new name, and editing goes on in the copy. Rename refuses a name the project has; Duplicate offers to replace that map, which then goes to backups.
- **Import** (Project › Import map…, Ctrl+O) replaces Open. A `.balledit`, `.ballmap` or `.json` from anywhere is copied into `maps/` under the game's file name for it and opened from there: a `.balledit` byte for byte, a `.ballmap` as the `.balledit` the game would make of it. Its origin goes into `.ballest/link.json`, and a file imported from the game's maps folder under its own name is linked as that file's export from the start. A name the project already has asks: Replace (the project's copy goes to backups) or Import as copy (`<name> 2`). Import is off in Untitled Project.
- **Export to game** (Project menu) saves unsaved edits, then copies the project file byte for byte into the game's maps folder and records the export's path, hash and time in `link.json`. The page first runs Save's checks on the open map, because an imported file or a map with no edits reaches the game without passing through Save. A file past the game's character limit is refused at this step, on the bytes about to be copied, and nothing is written. A file in that folder whose `levelPublishedFileId` is above 0 is a published map's draft, and the editor asks before replacing it.
- **Export on save** (Project menu, or the map's entry in Project settings; off by default, kept with the map's prefs) makes every Save of that map export too. Settings › General › Export every save does it for every map. The first Save of a new map doesn't export under either.
- **Launch game** (Project menu) opens `steam://rungameid/3339810`, or says the game is already running.
- **Backups.** Every write over a map file keeps the old one first (§ Backups). Recover previous version… in a map's menu in the Project panel lists them.
- **Toasts** name the project or the maps folder and offer Reveal.
- **Unsaved changes** are asked about before anything would lose them: closing the window, reloading, quitting, closing a map's tab, replacing a map open in a tab (Re-import, Recover, Import's Replace), and switching projects (New project…, Open project…, Recent projects). New map, opening a map and Import open a tab of their own and ask nothing. See § Window.

### Document tabs

`components/DocumentTabs.tsx` puts a tab over the viewport for each open map, each with its own history, selection, grid height and camera view. The web review build has tabs too, for maps in memory.

- Opening a map (the Project panel, a notification's Open) makes its tab active, or opens it in a new tab after the active one. New map, Import and Recover of a map that isn't open do the same. The fresh map the app starts on gives way to the first map opened while it is untouched. Opening a map shows no toast.
- The store keeps the active tab's state where every edit works and parks the others (`TabState`, `parkedTabs`). A save lands in the tab it started from.
- There is always a map, never a Start tab or an empty editor. On launch the app opens the map that was open when it last ran, else the project's most recently edited map, else a fresh unsaved map (what New map starts, named Untitled, nothing written; its first Save names it into the project).
- The active tab's map is kept per project in `desktop-settings.json` (`project.lastOpenMap`, by project folder; `ProjectState.lastOpenMap`, IPC `ballest:project:rememberOpenMap`), written whenever the active tab's file changes after the startup load. The other tabs aren't reopened yet.
- A tab shows the map's name without the creator (`mapLabelOf`), its tooltip is the file's path or "Not saved yet", and tabs can be dragged into another order.
- A tab's ×, a middle click or Ctrl+F4 closes it after the unsaved-changes prompt (§ Window). Closing the last one shows a fresh map the same way.
- A right-click opens the tab's menu: Close, Close others, Close to the right, and on desktop Rename…, Duplicate… and Reveal.
- Ctrl+Tab and Ctrl+Shift+Tab, or Ctrl+PageDown and PageUp, cycle the tabs.

### Menus

`components/MenuBar.tsx` holds the menus. Every item calls the entry point its keybind or button uses.

- **File:** New project… (`components/NewProjectDialog.tsx`, a name that becomes `Documents/Ballest Editor/<name>` through `createProject`), Open project…, Recent projects, Save, Close tab, Settings…, Game link…, and Quit, which closes the window the way its × does, so unsaved edits ask.
- **Edit** and **View.**
- **Project:** New map…, Import map…; Export to game, Export on save, Re-import from game, Play, Launch game; Project settings….
- **Web review build:** File (New map…, Open…, Save, Export…, Close tab, Settings…), Edit, View, and Project (Project settings…, the one map's).

There is no Map or Game menu: the menus act on the active tab's map, and the game is the project's export target. Rename, Duplicate and Recover previous version are per map in the Project panel. The Game link is the user's machine, not the project's, so it sits with Settings under File.

### Project panel

`components/ProjectPanel.tsx` is the left dock's Project tab beside Pieces (`components/LeftDock.tsx`; View › Project). It lists the project and its maps, the way an editor's file explorer shows a workspace.

- Each row shows the map, a dot while it is open in a tab with unsaved edits, and its link state as a glyph. Hovering names the state and says when the map was last edited.
- A click opens the map.
- Its menu (⋮, or a right-click) holds Open, Rename…, Duplicate…, Recover previous version…, Export to game, Play and Reveal. The ones that act on the open map open it first (`withProjectMapOpen`). Reveal shows the project's maps folder, not the file.
- The header holds New map…, Import map… and Project settings….
- A map with no file yet, a fresh one or any in Untitled Project, is a row of its own in italics.
- No thumbnails yet.

### Game link

`components/GameLink.tsx`, with rows from `domain/gameLink.ts`, is the one place the app describes the game's install, its maps folder, the creator name (`useCreator()`), the plugin manager and the editor plugin. It has two frames: `components/GameLinkDialog.tsx`, a modal from File › Game link…, and Settings › Game, a page with the same rows flush like other settings, its summary line as the description and Check again where a row's reset goes.

Each row has its state. The install, maps folder and plugin manager rows also have their path and Reveal, and the editor plugin row its path. A missing one carries its fix:

- **The install:** Choose folder…, a folder dialog. A folder without the game's exe keeps the row red with main's reason, and nothing is saved.
- **The maps folder,** once the game is found: "Run the game once to create its maps folder" and Choose folder….
- **The editor plugin:** Install or Update (§ Installing the plugin).
- **The creator:** Set name… (Settings › General).

A folder that is there has a Choose another folder… action on its path. One chosen that way says "Chosen here instead of the one Steam knows about." with a reset button (↺) that looks it up again (`resetGamePaths`). In Settings an overridden folder also marks the Game category and the row with the "modified" dot, and Reset game to defaults resets every chosen folder.

The plugin manager (`noPluginManager`) is optional, because only Play needs it. Its row is neutral ("Not installed (optional, for Play)") with an Install docs button to its README (`openExternal`), never red. While its plugins folder isn't found, the row also has Choose folder…, for a plugin manager whose plugins folder is somewhere unusual.

Rows that need an earlier one wait for it: the maps folder and the plugin manager need the game, and the plugin needs the plugin manager. A chosen folder is saved as the override, and the other folders and the plugin are looked up again, so the rows update in place. Check again looks everything up again.

The dialog opens by itself on the first launch (`gameLink.firstRun`) and when the startup check finds the game or its maps folder missing, which is what Export needs. A missing plugin manager never opens it.

### Project settings

`components/ProjectSettingsDialog.tsx`, in `SettingsShell`'s shape, has _Project › General_ on the left, then _Maps_ with an entry per map. Project › Project settings… opens on the project, and the map's settings button in the Inspector (`openDialog({ id: "mapSettings" })`) opens on the open map's entry. The web review build has only the one map's entry.

General has the project's name and its places:

- The name is editable and goes into `ballest-project.json` through `renameProject` (IPC `ballest:project:rename`), and the folder keeps its name. In Untitled Project the field is empty, and typing a name names the project (`nameProject`), as the Save dialog does.
- The places each have a Reveal (`revealProject`, IPC `ballest:project:reveal` with `which`): the project folder, with Open another project… beside it; its `maps/`; its `.ballest/backups/`. In Untitled Project these read "Made when the project is named". The game's maps folder, where exports go, has a Reveal too (`revealGamePath`).

A map entry has the name, file (Rename…, Duplicate…), level, grid height, Export on save, difficulty and tags. The entry of a map open in a tab, active or not, edits that tab's document (undo steps there, saved when the tab is) and its prefs. A map not open anywhere is read from its file when its entry shows and edited on disk through the save path (`patchProjectMapEffect`: read, patch, `saveMap`, or `renameMap` when the name changed, so the old file goes to the backups), along with the prefs kept for it.

### Status bar

The status bar runs along the bottom. The project is the window's title, centred in the top bar.

- In the middle: the open map's link state (`domain/linkState.ts`) and when it was last exported, with a popover for the export's path and time, Reveal, Export to game and Play. A map with no file shows "Not saved in the project yet".
- On the right: the update pill and the notification bell.

The link states are Not exported, In sync, Edited since export, Changed in game, Both changed and Published draft. A map's state comes from `listMaps`: each `ProjectMap` carries the SHA-256 of its file, compared with `link.export.hash`, and its `publishedFileId`, the project file's `levelPublishedFileId`, read once per file version (main caches them by time, size and inode). Changed in game comes from the link: its `lastSeenHash` differs from `export.hash`. It's Both changed when the project map was saved or has unsaved edits since the export. A change in the game outranks Published draft, which outranks the project side, so a published draft with edits never shows Edited since export. The popover adds Re-import in the two changed states.

### Notifications

The store's `notify(level, title, { kind, body, persistent, actions })` records a `NotificationRecord` (`@ballest/contracts`), and `showToasts` toasts each new one, with its first action as the toast's button.

- Actions are data (`NotificationCommand`: `RevealProject`, `RevealGamePath`, `ChooseGamePath`, `OpenMap`, `OpenExternal`, `InstallPlugin`, `ReimportMap`, `Dismiss`), so they still work after a restart. `runNotificationCommand` runs them.
- The bell lists them newest first, grouped by day, the unread ones counted. A `persistent` one is pinned to the top until `resolveNotifications(kind)`, and a newer one of its kind replaces it. Mark all read; Clear keeps only the pinned.
- The last 100 are kept in `<userData>/notifications.json` (`NotificationLog` in main, `loadNotifications` / `saveNotifications` over IPC). One entry that doesn't decode is dropped, not the file. A browser keeps them in memory.

**Game link notifications.** At startup the page looks up the folders and the plugin (`checkGameLinkEffect`) and compares whether the game and the plugin manager are found with what the last launch found, kept in `desktop-settings.json` (`gameLink.last`, IPC `ballest:gameLink:memory` / `ballest:gameLink:remember`). Only a change is notified: the game lost (`gameNotFound`, persistent, Choose folder…) or found again (`gameFound`), and while the game stays, the plugin manager gone (`pluginManagerMissing`, persistent, Install steps) or back (`pluginManagerFound`). Play reports a missing game or plugin manager under the same two kinds (§ Play).

The first launch notifies nothing, since the checklist is in front of the user. A persistent one resolves itself as soon as a lookup finds its cause gone (at startup, or after Choose folder…, reset or Install in this session), and that lookup's result is kept, so a fix made in the editor isn't announced again on the next launch. These kinds offer Don't show again: the kind goes into `desktop-settings.json` (`notifications.muted`, IPC `ballest:notifications:mute`), its notifications leave the list, and `notify` drops new ones.

### Backups

Every write over an existing map file goes through one step, `Backups.overwrite` (`apps/desktop/src/project/Backups.ts`): the old bytes are kept in a backups folder, the new ones are written atomically, and that folder is pruned. Save, Duplicate over a map, Import replacing a map, Export to game, Play's export, Re-import and the Export confirm's Back up and overwrite (§ Sync) all use it. Rename moves the old file into the backups instead (`Backups.retire`).

- **Where.** The project's own files go to `<project>/.ballest/backups/`. The files Export writes over in the game's maps folder go to `<userData>/backups/`, which is the app's: a project can be shared, but the game's copy of a map is this machine's. Both folders are flat: `<time> <file name>`, the time in ISO 8601 UTC with `-` for `:` and `.` (`2026-10-31T12-00-00-000Z Map_LevelEditorMain&Big Loop_Isaac.balledit`). Two backups of a file in the same millisecond get consecutive times, so names never collide and their order holds.
- **Skipped** when the new bytes are the old ones (nothing is written either), or when the newest backup of that file already holds the old bytes. A backup that fails stops the write, so the old file is never lost to a failed copy.
- **Retention.** After each write the folder keeps the newest 20 versions of each file and drops any older than 30 days. `desktop-settings.json` can change both: `{ "backups": { "keep": 20, "maxAgeDays": 30 } }` (no UI yet). Git history (#105) is the long-term version history; this is the safety net.
- **Recover** (the Project panel › a map's menu › Recover previous version…) shows the open map's versions, newest first, and All backed-up maps for the others, including maps no longer in the project. Main lists both folders (`listBackups`) and reads a backup by its place and name (`readBackup`), refusing any name it didn't write, so paths stay in main. Each version shows its time, whose copy it is (Project or Game) and, decoded through `MapFile` as Open would, its item count and map name.
- **Opening a version** shows it in the map's tab when one has it open, asking about that tab's unsaved edits first (§ Window; the prompt's Save goes through the backups like any Save), else in a new tab. It loads as unsaved edits of the project map of that file name, so Save writes it over that map, backing up the current file first. A map no longer in the project opens as a new one, and Save names it.
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
- **Re-import** (`MapExports.reimportMap`, IPC `ballest:project:reimportMap`; from the notification, the status bar popover, or Project › Re-import from game). When the map is open in a tab, that tab is made active, and with unsaved edits the unsaved-changes prompt asks first ("…before re-importing it from the game?"). Main reads the export (only the map's own file in the game's maps folder; a map without one is refused), writes its bytes over the project map through `Backups.overwrite`, which sends the project's version to `<project>/.ballest/backups/`, and records it as the export and as seen, so the map is In sync. The page reloads the map in its tab if it is open, and the notification says where the previous version went. There's nothing to re-match yet, because the sidecar (#112) doesn't exist.

Main touches map files only inside the project's `maps/` and `.ballest/` folders, in the game's maps folder and in `<userData>/backups/`, named by file name, never by path. Import reads a file the user picked in its open dialog.

### Window

The page's top bar is the window's title bar. The window has `titleBarStyle: "hidden"` and a `titleBarOverlay`: Electron draws only the window controls, over one end of the top bar, on the side the desktop puts them (GTK's button layout on Linux). The top bar is a drag region (`-webkit-app-region: drag`, buttons `no-drag`) and pads itself clear of the controls with `env(titlebar-area-x/width)`, which a browser leaves undefined. The page reports its resolved theme (`setWindowTheme`) and main recolours the controls and the window background to match. Same approach as t3-code's.

The window and taskbar icon is `dist-electron/icon.png`, which apps/desktop's build renders from `resources/icon.svg` (256 px, with `@resvg/resvg-js`) and `DesktopEnvironment.iconPath` points at; the window's `icon` option sets it. Linux takes it from there (X11's `_NET_WM_ICON`); Windows shows the exe's icon, which tools/release renders from the same SVG. `productName` ("Ballest Editor") is set in the packaged app's `package.json` (tools/release `config.ts`); unpackaged runs keep the workspace name, so they keep a profile of their own.

**Unsaved changes.** One prompt per map, Save / Don't save / Cancel, guards everything that would lose a map's edits. The page words it ("Save the changes to Big Loop before closing?", `domain/unsaved.ts`) and `Platform.confirmUnsaved` shows it: on desktop a native message box modal to the window (IPC `ballest:window:confirmUnsaved`, `ElectronDialog.showMessageBox`; Escape is Cancel), in a browser a `confirm` whose OK is Don't save. `editor/actions`' `unlessCancelled(action, next)` asks about the active tab only while its map is dirty: Save runs the editor's Save and goes on once it has written the file (a map with no file yet opens the Save map dialog first, and goes on when that saves; its Cancel, or a failed save, stops there), Don't save goes on, Cancel stops. Closing a tab, and replacing a map open in a tab (`unlessCancelledFor`: Re-import, Recover, Import's Replace), make that tab active and ask about it. Closing the window, reloading and switching projects ask about every tab with unsaved edits in turn (`unlessAnyCancelled`), making each active to ask; the first Cancel stops there. Switching projects keeps the open maps open, unsaved, in the new project, so there Save writes each into the project being left.

Closing and reloading go through the page's `beforeunload`, which cancels the unload while any tab has unsaved edits. A browser then shows its own leave-page dialog. In the desktop app the window stays open: main sees `will-prevent-unload` and sends `ballest:window:unloadRequest` with `"close"` (when the window's `close` event came first: the close button, Alt+F4, Ctrl+Q, quitting) or `"reload"` (Ctrl+R in an unpackaged build, a Vite full reload in dev). The page asks, and unless the user cancels it stops holding the unload and closes (`window.close()`) or reloads itself. Restarting from the update pill doesn't ask again: the pill already says unsaved changes are lost.

Installed builds have no application menu (`Menu.setApplicationMenu(null)`): the page's menu bar is the UI, and Electron's default menu would reload or close the window behind the editor's back. Its Close Window is on Ctrl+W, which is two fly keys held together, and a hidden menu's accelerators still fire. Main handles the two window shortcuts it would have given, F11 (fullscreen) and Ctrl+Q (quit), in `before-input-event`. Unpackaged builds replace the default menu with a hidden one that has only Reload, Force Reload and Toggle DevTools (`devMenuTemplate`). Ctrl+W reaches the page in both: `before-input-event` must not `preventDefault` it, or the page loses the keydown and the camera stops flying. Alt+F4 and window snapping come from the OS, not the menu.

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

It answers `Played` with the export, the link, the plugin's status, whether `play.json` was written (`sent`) and `launch` (`running`, `launched`, or `failed` when Steam couldn't be asked). The page tells the outcome as a notification:

- "Racing Big Loop in the game" or "Starting the game to race Big Loop". An `outdated` plugin adds Update plugin.
- `failed`: an error, "Exported Big Loop, but couldn't ask Steam to start the game. Is Steam running?"
- When the plugin couldn't be reached, a pinned one that names the cause (`playWithoutPluginNotice` in `domain/gameLink.ts`). A missing game or plugin manager uses the Game link's own kinds (`gameNotFound` with Choose folder…, `pluginManagerMissing` with Install steps), so there is one pinned notification per cause whether the startup check or Play found it, and the Game link resolves it once the cause is gone. Only a missing plugin is Play's own kind, `pluginMissing` ("Exported Big Loop and started the game. Install the editor's plugin and Play races it for you", with Install plugin), and installing the plugin resolves it.

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

- #73: confirm redistribution rights for the asset pack and for the Workshop maps in `samples/`, and choose a license.
- #74: fork-safe CI and branch rules.
- #75: `CONTRIBUTING.md`, issue templates, `SECURITY.md`, `CODEOWNERS`.
- #77: code signing.
- #110: the quiet public switch and the Vercel reconnect.
