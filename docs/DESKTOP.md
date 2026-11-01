# Desktop-first

Status: planned (milestone 0.2, GitHub project [Ballest Editor](https://github.com/orgs/ballest-editor/projects/1)). Written 2026-10-30.

The editor becomes an Electron app for Windows and Linux. The web build stays, but only as a review build for pull requests and `main`. This page is the design; the issues under milestone 0.2 are the work.

## Why

- **Egress.** The game's meshes and textures (53 MB compressed) were served to every browser session from a hosted object store. Once the editor is open source and public, a website would pay for that on every visit. A desktop app ships them once, inside the installer.
- **The game is local.** The maps folder, the game launch and the plugin manager's play handoff (below) all need the file system and the shell, which a browser doesn't get.
- **No server.** The app has one route and no server functions; SSR buys nothing for a WebGL editor and costs a hydration workaround (`panelWidthsScript`).

What doesn't change: positions in centimetres, quaternions, UE frame, the `MapFile` and `Catalog` schemas, the layer rules, Effect for everything non-trivial.

## Layout after the split

Mirrors [t3-code](https://github.com/pingdotgg/t3code) (`apps/web` + `apps/desktop` + `packages/contracts`), which also runs Effect v4 in the Electron main process. Read its `apps/desktop/src/main.ts`, `app/DesktopApp.ts`, `electron/ElectronProtocol.ts`, `ipc/DesktopIpc.ts`, `preload.ts` and `packages/contracts/src/ipc.ts` before building ours; the patterns below come from there.

```
apps/
  web/        the renderer: the editor, formerly apps/editor (plain Vite SPA + TanStack Router)
              layers as now: domain/ ← services/ ← editor/ ← components/ ← routes/
  desktop/    Electron main + preload. Effect main process (@effect/platform-node), no React
packages/
  ui/         shadcn (unchanged)
  contracts/  Schemas and the DesktopBridge interface shared by preload, main and renderer. Depends on effect only,
              exports src directly (no build)
tools/
  compress/   + download.mjs: fetches the asset pack when web-assets/ isn't on disk
```

**No `packages/core` yet.** `domain/` and `services/` are already platform-neutral and have one consumer, the renderer. The main process needs none of them (it moves bytes, finds folders, launches things). Extract a core package when a second consumer exists; the lint rules keep the boundary clean until then.

### Renderer: one app, one `Platform` service

The renderer never imports `electron`. It gets a `Platform` service (`apps/web/src/services/Platform.ts`) with two layers:

| Capability         | Browser layer       | Desktop layer (through `window.ballest`, the preload bridge) |
| ------------------ | ------------------- | ------------------------------------------------------------ |
| Open / Import      | `<input type=file>` | native open dialog; the file is copied into the project      |
| Save               | download link       | writes the map in the project, asking nothing                |
| Export to game     | hidden              | copies the project map into `UserSavedMaps`                  |
| Launch game, Play  | hidden              | `steam://rungameid/3339810`, plugin handoff                  |
| Open external link | `window.open`       | `shell.openExternal`                                         |
| Updates            | none                | electron-updater state stream                                |

`Platform.layer` is picked at module load: `window.ballest !== undefined` means desktop (the preload runs before any page script, so that test is reliable). Components still reach it through `editor/actions`. Settings, keybinds and map prefs stay in `localStorage` (Electron persists it under `userData`); nothing to migrate.

On desktop the maps live in a **project folder** ([PROJECTS.md](PROJECTS.md), phase 1): `Documents/Ballest Editor/Maps` by default, made on disk by the first New map or Import, or a folder chosen with File › Choose project folder… (the recent ones are under File › Recent projects). The game's maps folder, or a folder inside it, is refused with the reason: the game scans its subfolders and rewrites what it finds. The flow:

- **New map** asks for the name and creator and saves the map into the project at once; the dialog shows the file name it exports as.
- **Save** (Ctrl+S) writes the project file and asks nothing. A map that has no file yet (one left open after switching projects) is named first. After the name or creator changed, Save moves the file to the new name and the old one goes to `<project>/.ballest/backups/`.
- **Rename** and **Duplicate** (Map menu) replace Save as: Rename changes the name or creator and moves the file; Duplicate saves a copy under a new name and editing goes on in the copy. Rename refuses a name the project has; Duplicate offers to replace that map (it goes to backups).
- **Import** (File menu, Ctrl+O) replaces Open: a `.balledit`, `.ballmap` or `.json` from anywhere is copied into `maps/` under the game's file name for it (a `.balledit` byte for byte; a `.ballmap` as the `.balledit` the game would make of it) and opened from there. Its origin goes into `.ballest/link.json`; a file imported from the game's maps folder under its own name is linked as that file's export from the start. A name the project already has asks: Replace (the project's copy goes to backups) or Import as copy (`<name> 2`).
- **Export to game** (Map menu) saves unsaved edits, then copies the project file byte for byte into the maps folder (below) and records the export's path, hash and time in `link.json`. **Export on save** (Map menu, or Map settings; off by default, kept with the map's prefs) makes every Save export too.
- **Backups** (below): every write over a map file keeps the old one first. **Recover previous version…** (Map menu) lists them.
- Toasts name the project or the maps folder and offer Reveal.
- **Unsaved changes** are asked about before anything would lose them: closing the window, reloading, New map, Open map, Import, and switching projects (Choose project folder…, Recent projects). See § Window.

The window around the map follows [PROJECTS.md § Shell](PROJECTS.md#shell) (#140):

- **Document tabs** over the viewport: Start, then the open map's (one map at a time for now). The app starts on Start; opening a map from it, New map or Import shows the map's tab. Closing the map's tab (its ×, or File › Close map) shows Start again; with unsaved edits it asks first with the same prompt as closing the window (§ Window), and so does opening another map over them from Start. View › Start brings Start back while a map is open. With Start in front the viewport and the side panels are hidden (still mounted), the map's menu items are off, and the only keybinds that run are New map, Import and the cheat sheet.
- **Start tab:** the project's maps, most recently changed first, each with its link state and when it was last edited; New map and Import…; and the Game link checklist (below). The browser build starts on its one map; its Start has New map and Open…, and no Game link.
- **Game link** (`components/GameLink.tsx`, rows from `domain/gameLink.ts`): one row each for the game's install, its maps folder, the creator name (`useCreator()`), the plugin manager and the `ballest-editor-link` plugin, each with its state, its path and Reveal. A missing one carries its fix: the install, **Choose folder…** (the same folder dialog and exe check as Settings › Game; a folder without the exe keeps the row red with main's reason, and nothing is saved); the maps folder once the game is found, "Run the game once to create its maps folder" and Choose folder…; the plugin manager (`noPluginManager`), **Install docs** (its site, `openExternal`); the plugin, **Install** or **Update** (§ Installing the plugin); the creator, Set name… (Settings › General). Rows that need an earlier one (the maps folder and the plugin manager without the game, the plugin without the plugin manager) wait for it. A chosen folder is saved as the override and the other folders and the plugin are looked up again, so the rows update in place; ⟳ looks everything up again. The checklist is expanded on the first launch and while anything is missing; once everything is found it is one summary row (`✓ game ✓ maps ✓ creator Isaac ✓ plugin manager ✓ plugin`) that expands.
- **Game link notifications.** At startup the page looks up the folders and the plugin (`checkGameLinkEffect`) and compares whether the game and the plugin manager are found with what the last launch found, kept in `desktop-settings.json` (`gameLink.last`, IPC `ballest:gameLink:memory` / `ballest:gameLink:remember`). Only a change is notified: the game lost (`gameNotFound`, persistent, Choose folder…) or found again (`gameFound`), and while the game stays, the plugin manager gone (`pluginManagerMissing`, persistent, Install steps) or back (`pluginManagerFound`). The first launch notifies nothing, since the checklist is in front of the user. A persistent one resolves itself as soon as a lookup finds its cause gone (at startup, or after Choose folder…, reset or Install in this session), and that lookup's result is kept, so a fix made in the editor isn't announced again on the next launch. These kinds offer **Don't show again**: the kind goes into `desktop-settings.json` (`notifications.muted`, IPC `ballest:notifications:mute`), its notifications leave the list and `notify` drops new ones.
- **Status bar** along the bottom: the project on the left; in the middle, the open map's link state (`domain/linkState.ts`: Not exported, In sync, Edited since export, Changed in game, Both changed, Published draft) and when it was last exported, with a popover for the export's path and time, Reveal and Export to game; on the right the update pill and the notification bell. A map's link state comes from `listMaps`: each `ProjectMap` carries the SHA-256 of its file (compared with `link.export.hash`) and its `levelPublishedFileId`, read once per file version (main caches them by time, size and inode). Changed in game and Both changed need the game file's hash, which sync detection (#141) passes in.
- **Notifications.** The store's `notify(level, title, { kind, body, persistent, actions })` records a `NotificationRecord` (`@ballest/contracts`); `showToasts` toasts each new one, with its first action as the toast's button. Actions are data (`NotificationCommand`: `RevealProject`, `RevealGamePath`, `ChooseGamePath`, `OpenMap`, `OpenExternal`), so they still work after a restart; `runNotificationCommand` runs them. The bell lists them newest first, grouped by day, the unread ones counted; a `persistent` one is pinned to the top until `resolveNotifications(kind)`, and a newer one of its kind replaces it. Mark all read; Clear keeps only the pinned. The last 100 are kept in `<userData>/notifications.json` (`NotificationLog` in main, `loadNotifications` / `saveNotifications` over IPC; one entry that doesn't decode is dropped, not the file); a browser keeps them in memory.

#### Backups

Every write over an existing map file goes through one step, `Backups.overwrite` (`apps/desktop/src/project/Backups.ts`): the old bytes are kept in a backups folder, then the new ones are written atomically, then that folder is pruned. Save, Duplicate over a map, Import replacing a map, Export to game and Play's export (#66) use it; Rename moves the old file into the backups instead (`Backups.retire`). Re-import and the Export confirm's **Back up and overwrite** (#141) are to call the same step.

- **Where.** The project's own files go to `<project>/.ballest/backups/`; the files Export writes over in the game's maps folder go to `<userData>/backups/`, which is the app's (a project can be shared, the game's copy of a map is this machine's). Both folders are flat: `<time> <file name>`, the time in ISO 8601 UTC with `-` for `:` and `.` (`2026-10-31T12-00-00-000Z Map_LevelEditorMain&Big Loop_Isaac.balledit`). Two backups of a file in the same millisecond get consecutive times, so names never collide and their order holds.
- **Skipped** when the new bytes are the old ones (nothing is written either), or when the newest backup of that file already holds the old bytes. A backup that fails stops the write, so the old file is never lost to a failed copy.
- **Retention.** After each write the folder keeps the newest 20 versions of each file and drops any older than 30 days. `desktop-settings.json` can change both: `{ "backups": { "keep": 20, "maxAgeDays": 30 } }` (no UI yet). Git history (#105) is the long-term version history; this is the safety net.
- **Recover** (Map › Recover previous version…) shows the open map's versions, newest first, and **All backed-up maps** for the others, including maps no longer in the project. Main lists both folders (`listBackups`) and reads a backup by its place and name (`readBackup`), refusing any name it didn't write; paths stay in main. Each version shows its time, whose copy it is (Project or Game) and, decoded through `MapFile` as Open would, its item count and map name. **Open** asks about the open map's unsaved edits first, like opening any other map (§ Window; the prompt's Save goes through the backups like any Save), then loads the version as unsaved edits of the project map of that file name, so Save writes it over that map, backing up the current file first; a map no longer in the project opens as a new one and Save names it.
- **Maps the game changes on its own** (the in-game editor saving into `UserSavedMaps`) are not snapshotted: the editor only loses a game edit when Export writes over it, and that copy is kept. Watching the folder would back up every in-game save (the game rewrites `editorState` each time) for little gain; #141's sync detection reports those edits instead.

Main touches map files only inside the project's `maps/` and `.ballest/` folders, in the game's maps folder and in `<userData>/backups/`, named by file name, never by path; Import reads a file the user picked in its open dialog. The browser review build has no project: one map in memory, Open is the file input and Export (or Save) is a download.

### Window

The page's top bar is the window's title bar. The window has `titleBarStyle: "hidden"` and a `titleBarOverlay`: Electron draws only the window controls, over one end of the top bar, on the side the desktop puts them (GTK's button layout on Linux). The top bar is a drag region (`-webkit-app-region: drag`, buttons `no-drag`) and pads itself clear of the controls with `env(titlebar-area-x/width)`, which a browser leaves undefined. The page reports its resolved theme (`setWindowTheme`) and main recolours the controls and the window background to match. Same approach as t3-code's.

The window and taskbar icon is `dist-electron/icon.png`, which apps/desktop's build renders from `resources/icon.svg` (256 px, with `@resvg/resvg-js`) and `DesktopEnvironment.iconPath` points at; the window's `icon` option sets it. Linux takes it from there (X11's `_NET_WM_ICON`); Windows shows the exe's icon, which tools/release renders from the same SVG. `productName` ("Ballest Editor") is set in the packaged app's `package.json` (tools/release `config.ts`); unpackaged runs keep the workspace name, so they keep a profile of their own.

**Unsaved changes.** One prompt, Save / Don't save / Cancel, guards everything that would lose the open map's edits. The page words it ("Save the changes to Big Loop before closing?", `domain/unsaved.ts`) and `Platform.confirmUnsaved` shows it: on desktop a native message box modal to the window (IPC `ballest:window:confirmUnsaved`, `ElectronDialog.showMessageBox`; Escape is Cancel), in a browser a `confirm` whose OK is Don't save. `editor/actions`' `unlessCancelled(action, next)` asks only while the map is dirty: Save runs the editor's Save and goes on once it has written the file (a map with no file yet opens the Save map dialog first, and goes on when that saves; its Cancel, or a failed save, stops there), Don't save goes on, Cancel stops. New map asks before its dialog opens; Open map, Import, closing the map's tab and the project switches before they run. Switching projects keeps the open map open, unsaved, in the new project, so there Save writes it into the project being left.

Closing and reloading go through the page's `beforeunload`, which cancels the unload while the map has unsaved edits. A browser then shows its own leave-page dialog. In the desktop app the window stays open: main sees `will-prevent-unload` and sends `ballest:window:unloadRequest` with `"close"` (when the window's `close` event came first: the close button, Alt+F4, Ctrl+Q, quitting) or `"reload"` (Ctrl+R in an unpackaged build, a Vite full reload in dev). The page asks, and unless the user cancels it stops holding the unload and closes (`window.close()`) or reloads itself. Restarting from the update pill doesn't ask again: the pill already says unsaved changes are lost.

Installed builds have no application menu (`Menu.setApplicationMenu(null)`): the page's menu bar is the UI, and Electron's default menu would reload or close the window behind the editor's back. Main handles the two window shortcuts it would have given, F11 (fullscreen) and Ctrl+Q (quit), in `before-input-event`. Unpackaged builds keep the default menu, hidden, for its reload and DevTools keys. Alt+F4 and window snapping come from the OS, not the menu.

### Main process

Effect layers, same shape as t3-code:

- `electron/*`: one `Context.Service` per Electron API we touch (`ElectronApp`, `ElectronWindow`, `ElectronProtocol`, `ElectronDialog`, `ElectronShell`, `ElectronUpdater`). Listeners are scoped with `acquireRelease`.
- `app/`: `DesktopEnvironment` (paths: `userData`, `resourcesPath`, `isPackaged`, dev server URL from `VITE_DEV_SERVER_URL`), `DesktopApp.program` (whenReady → protocol → IPC handlers → window → updater), fatal errors to `dialog.showErrorBox`.
- `game/`: `SteamLibrary` (finds the install from `libraryfolders.vdf` + `appmanifest_3339810.acf`, like the plugin manager's `find_game.sh`), `GamePaths` (maps folder, plugins folder; Windows and Proton variants, see below), `GameLink` (the plugin's status and install, later the play handoff).
- `ipc/`: `makeIpcMethod({ channel, payload: Schema, result: Schema, handler })`, decode in, encode out, `ipcMain.handle` inside `acquireRelease`. Main pushes to the renderer with `webContents.send`.
- Entry: `Effect.provide(layerDesktopRuntime)` then `NodeRuntime.runMain`. `registerSchemesAsPrivileged` runs before `whenReady`.

The window loads `ballest://app/` in production and `ballest-dev://app/` in dev. `protocol.handle` serves the renderer build from `app.asar` and `/assets/*` from `process.resourcesPath/assets` (SPA fallback to `index.html`, path-traversal guard, MIME by extension, a CSP header). In dev the handler proxies to the Vite dev server with `net.fetch`; HMR connects straight to the Vite port. The router uses hash history under Electron.

`webPreferences`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The preload is a self-contained bundle (a sandboxed preload can't resolve imports from inside asar) exposing `window.ballest satisfies DesktopBridge`.

### Game paths

|         | Windows                                          | Linux (Proton)                                                                                                 |
| ------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Install | `<library>/steamapps/common/Ballest of Them All` | same                                                                                                           |
| Maps    | `%LOCALAPPDATA%\Ballest\Saved\UserSavedMaps`     | `<library>/steamapps/compatdata/3339810/pfx/drive_c/users/steamuser/AppData/Local/Ballest/Saved/UserSavedMaps` |
| Plugins | `<install>/Ballest/Binaries/Win64/plugins`       | same                                                                                                           |

`apps/desktop/src/game/` finds them without configuration:

- **Steam's folder.** Windows: the registry (`HKCU\Software\Valve\Steam` `SteamPath`, then `HKLM` `InstallPath`), then `%ProgramFiles(x86)%\Steam` and `%ProgramFiles%\Steam`. Linux: `~/.local/share/Steam`, `~/.steam/steam`, `~/.steam/root`, the Flatpak (`~/.var/app/com.valvesoftware.Steam/.local/share/Steam`) and the Snap. Folders that resolve to the same place count once.
- **The game.** Every library `steamapps/libraryfolders.vdf` lists (current and pre-2021 formats); the first with `steamapps/appmanifest_3339810.acf` whose `installdir` holds `Ballest/Binaries/Win64/Ballest-Win64-Shipping.exe`. The same algorithm as the plugin manager's `tools/find_game.sh`.
- **Maps.** Found when the game's `Ballest/Saved` folder exists (the game makes it on its first run); Export to game creates `UserSavedMaps` in it if the in-game editor never saved a map. Under Proton the prefix is looked for in the game's library first, then in every other library.
- **Plugins.** Found when the folder exists, which means the plugin manager is installed.
- **Running.** Windows: `tasklist` for `Ballest-Win64-Shipping.exe`. Linux: a `/proc/*/cmdline` naming that exe (Proton runs it as an argument, so the process name doesn't match).
- **Creator.** The game writes the Steam persona name into every map's `creatorName` and file name, so `GameCreator` reads it from `<steam>/config/loginusers.vdf` in each of Steam's own folders (the same ones above, registry included): the user with `MostRecent "1"`, else the newest `Timestamp` (Steam on Linux writes no `MostRecent`). Without a login file, it takes the creator most `.balledit` file names in the maps folder end in. The renderer gets `{ name, source: "steam" | "mapsFolder" }` or null (`findCreator`), unchecked: Settings › General › Creator name shows it ("From Steam") until the user types another name, which then sticks; "Use Steam name" goes back. A found name with characters a map file name can't hold isn't used, and the row says why. New map only asks for a creator when there is no usable one. `domain/creator.ts`'s `creatorOf` combines the setting and the found name into `{ name, source: "steam" | "mapsFolder" | "user" | "none", valid }`, the shape the Game link checklist's creator row (#134) shows.

The renderer gets each folder as `found | overridden | missing`, with the path it is or would be at. Settings › Game shows the three with **Choose…** (a folder dialog; an install must contain the game's exe), **Reveal** and reset; the Start tab's Game link shows them too, with Choose folder… on a missing one. Overrides live in `desktop-settings.json` under `game`; overriding the install moves the other two with it unless they are overridden too.

**Export to game** (Map menu) writes the map into the maps folder under the game's file name, as a copy of the project file (see § Renderer). A file there whose `levelPublishedFileId` is above 0 is a published map's draft, and the editor asks before replacing it. **Launch game** (Game menu) opens `steam://rungameid/3339810`, or says the game is already running.

The app never touches the install except the plugin's own folder below, and only through `GameLink`.

### Play: the plugin handoff

The [Ballest plugin manager](https://anythinggoes-ballest.github.io/ballest-plugin-manager/) runs AngelScript plugins inside the game. Its host (0.32.0) already has everything we need, so nothing has to be merged upstream:

- `Tracks::OpenLocal(name)` races a never-published `.balledit` from the maps folder as a normal race (pre-race menu, countdown, checkpoints, finish). The file is re-read on every entry, so pressing Play again picks up edits.
- `Plugins::ReadFile(path)` reads a file from the plugin's own folder, fresh each call.

So **Play** in the desktop app:

1. Exports the map into the maps folder (its `levelPublishedFileId` is -1; the host refuses anything else).
2. Writes `<plugins>/ballest-editor-link/play.json`: `{ "map": "Map_LevelEditorMain&<name>_<creator>.balledit", "nonce": <n> }`.
3. If the game isn't running (no `Ballest-Win64-Shipping.exe` process), opens `steam://rungameid/3339810`.

The plugin, `ballest-editor-link` (`packages/ballest-editor-link/`: `info.toml` + `main.as`), polls `play.json` from `Update(dt)` twice a second, and on a new nonce calls `Tracks::OpenLocal`. It uses no `Console::` and no network. Without the plugin manager installed, Play degrades to Export to game plus launch, and the editor says so.

#### Installing the plugin

It isn't published to the plugin manager's registry: the app ships it and installs it when the user asks.

- **Shipped.** The package's `build` (`scripts/stage.ts`) copies `info.toml` and the scripts its `[script] files` lists into `dist/ballest-editor-link/`; `apps/desktop#build` and `#dev` depend on it in turbo. `tools/release` stages that folder as `plugins/ballest-editor-link`, which electron-builder ships beside `app.asar` (`extraResources`). `DesktopEnvironment.pluginDir` is `resources/plugins/ballest-editor-link` when packaged, the package's `dist/` otherwise.
- **Status** (`GameLink.pluginStatus`, IPC `ballest:game:pluginStatus`), read the way the plugin manager's host reads manifests (the same TOML subset, `version` defaulting to 0.0.0, its `CompareVersions`: dot-separated numbers, a missing one counting as 0):

  | Status            | When                                                                                 |
  | ----------------- | ------------------------------------------------------------------------------------ |
  | `noGame`          | the install wasn't found                                                             |
  | `noPluginManager` | no `version.dll` next to `Ballest-Win64-Shipping.exe`, or no plugins folder          |
  | `missing`         | no `<plugins>/ballest-editor-link/info.toml`, or a file the app's copy has is absent |
  | `outdated`        | the installed `[meta] version` is older than the app's copy                          |
  | `current`         | as new or newer (a newer one, say a developer's, is left alone)                      |

- **Install** (`GameLink.installPlugin`, IPC `ballest:game:installPlugin`), only on the user's click, refused with `noGame` or `noPluginManager`. The files are copied into a `.ballest-editor-link-*` folder beside the plugin (same drive; the host skips folders starting with a dot) and each is renamed over its old copy, `info.toml` last, so a folder left half-updated still reads as the old version. Anything else in the folder, `play.json` included, stays; the plugin's last nonce lives in the plugin manager's storage, outside the folder. Nothing outside `<plugins>/ballest-editor-link/` is written. The plugin manager loads a folder copied in by hand only when the game starts, so the result says whether the game is running and the editor says "Restart the game to use Play".
- **UI.** Settings › Game has an **Editor plugin** row under the three folders: the folder, the status, **Install** or **Update**, and **Install steps** (the plugin manager's site) when the plugin manager is missing. The Game link checklist on the Start tab (§ Renderer) shows the same `Platform.pluginStatus` / `installPlugin` as its plugin manager and plugin rows.

Later: an `Editor::OpenLocal` host API for "open in the in-game editor", and a file-changed callback instead of polling. Both are upstream requests, not blockers.

### Assets

The extractor's output can't be rebuilt on CI (it needs the game). The compressed tree (`web-assets/`, meshopt + AVIF, 53 MB) is published as an **asset pack**: a tarball attached to a GitHub release tagged `assets-<tree-hash>`, with `tools/compress/web-assets.json` recording the tag and the tarball's SHA-256. `tools/compress/download.mjs` fetches and verifies it when `web-assets/` is missing; `//#assets` in turbo tries the local extractor output first, then the download. Desktop builds copy `assets/` (small committed files) and `web-assets/` into `extraResources`. The web build inlines the same files as static output. Vercel builds it through `turbo run build --filter=@ballest/web` (`apps/web/vercel.json`) so the download runs first.

Release downloads are free, and contributors without the game can build. `assetUrl.ts` addresses every asset at `/assets/*` on both platforms (the protocol handler maps that on desktop).

### Packaging and release

- **electron-builder**, run by `tools/release` (`pnpm dist:desktop:win|linux`; [tools/release/README.md](../tools/release/README.md)). It stages the app in a temp directory with a generated `package.json` whose `build` block is the config (so it can vary by platform, and later by channel and signing), and runs `--publish never`; the release workflow uploads. The staged app has no `node_modules` (main and preload inline their dependencies), the game assets go to `extraResources`, and the icons are rendered from `apps/desktop/resources/icon.svg`.
- **Targets:** Windows NSIS x64 (the players), Linux AppImage x64 (Proton users). No macOS: the game isn't on it.
- **Workflow `release.yml`:** on tag `v*.*.*` (or by hand with a tag), only in `ballest-editor/ballest-editor`. Builds the JS once, then one job per target (`release-desktop.yml`), then a release job that checks the installers, the Windows blockmap and `latest.yml` / `latest-linux.yml` against the version, writes `SHA256SUMS`, and publishes with `softprops/action-gh-release`. Drafted until every asset is attached; `-rc.N` tags are prereleases, never "latest".
- **Updates:** `electron-updater` against GitHub Releases (`apps/desktop/src/updates/`). It checks 15 s after start and every 4 minutes, and nothing downloads or installs unasked (`autoDownload` and `autoInstallOnAppQuit` are off). A pill at the right of the status bar, beside the bell, goes from a quiet "Update" (an arrow with a dot) to a progress ring with the percentage while it downloads, and to an accented "Restart to update" once the release is on disk; its tooltip names the version. Its popover opens upward: "What's new", the version, the release date and the running version, the release notes in a scroll area, then View on GitHub and Download or Restart, always in view. Main turns the GitHub release body (HTML) into plain blocks (headings, paragraphs, lists, code; bold, italics, code and http(s) links in the text; `apps/desktop/src/updates/releaseNotes.ts`): anything else is unwrapped to its text, script, style, frames and images are dropped with their content, and the page renders the blocks as text, so the notes can't run script or load anything. Links open in the browser through `openExternal`. Off in dev, when unpackaged, when `BALLEST_DISABLE_AUTO_UPDATE` is set, and on Linux outside the AppImage. `--mock-updates` builds and a mock update server (`pnpm release:mock-server`, a generic feed on 127.0.0.1) run the whole flow before a real release; see tools/release/README.md.
- **Signing:** unsigned at first (SmartScreen warns on Windows). Signing is an open-source milestone item: SignPath's OSS program or Azure Trusted Signing, done in the Windows job with env-gated secrets so fork PRs never see them.
- **Web review build:** Vercel deploys the web build for every pull request (a preview URL) and for `main` (production), so a change can be tried without installing anything. It isn't the product; users install the desktop app from the latest release.
- **CI on PRs:** still to come (#69): build the desktop bundle unpacked on Linux and Windows runners and launch it under Xvfb for a smoke check (window appears, catalog loads). Packaging and signing only on tags. Until then, `pnpm release:smoke` (stage the build, lay it out unpacked with electron-builder, check the config, bundles and assets are in place) runs in the release workflow before packaging, and locally when packaging changes.
  - **Xvfb has no GPU, so the editor can't render there as-is.** Found while testing `pnpm dev:desktop` under Xvfb (2026-10-30): Chromium logs `WebGL2 blocklisted`, three.js fails to create its context, and the editor's error boundary replaces the page ("Something went wrong"). The window, the protocol handler, IPC and the catalog fetch all still work. So the smoke check either asserts only on those, or turns on software GL and also checks that the canvas mounted: `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` renders the editor under Xvfb (checked against the packaged AppImage, #124). `start-electron.ts` passes its arguments through to Electron; `dev-electron.ts` doesn't take extra flags yet.
  - Running it locally on a Wayland desktop: Electron picks Wayland whenever `WAYLAND_DISPLAY` or `XDG_SESSION_TYPE=wayland` is set, even with `DISPLAY=:99`, and the window opens on the real screen. Unset both and set `ELECTRON_OZONE_PLATFORM_HINT=x11` to keep it on Xvfb. CI runners have no Wayland session, so this only matters on a developer machine.

### Dev workflow

`pnpm dev` runs the web app as now. `pnpm dev:desktop` runs vite for the renderer plus `vite build --watch` for main and preload, and a small runner (`apps/desktop/scripts/dev-electron.mjs`) that starts Electron once the bundles and the Vite port exist and restarts it when `main.cjs` or `preload.cjs` change. Main and preload are bundled to CJS with externals `electron` only (everything else bundled, as t3-code does).

Both root scripts go through `tools/dev/src/dev-runner.ts`, as in t3-code. It picks the checkout's port: 3000 for the main checkout, and for a linked worktree a port in 3001–5000 hashed from its path, so each worktree keeps its own port (and its own localStorage, which the browser keys by origin) and several can run at once. It sets `PORT`, `HOST` and `VITE_DEV_SERVER_URL` and runs the packages' `dev` tasks through turbo with `--env-mode=loose`: turbo's strict mode would strip those variables and the session ones Electron needs (`WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`, ...). `PORT=4000 pnpm dev` overrides the port. apps/web's Vite listens on that port with `strictPort`, so a clash fails instead of moving the window onto someone else's server, and tells the HMR client the socket's host and port, which the page's own URL, `ballest-dev://app/`, doesn't have. apps/desktop's watch build spawns the runner once both bundles are written, over an IPC channel, so the runner exits with it. The runner keeps the dev profile in `apps/desktop/.dev-user-data/` (through `BALLEST_USER_DATA_DIR`, which main applies before `ready`), so worktrees don't share Chromium's storage lock. Both launchers drop `ELECTRON_RUN_AS_NODE`, which Electron-based terminals (T3 Code, VS Code) export and which turns the binary into plain Node. `BALLEST_REMOTE_DEBUGGING_PORT` opens the window to DevTools Protocol clients.

Turbo: `apps/desktop#build` depends on `apps/web#build` and `//#assets`; `//#assets` gains the download fallback.

## Order of work

1. Drop TanStack Start; plain Vite SPA. Small and independently reviewable; everything else assumes it.
2. Split into `apps/web`, `apps/desktop`, `packages/contracts`; Electron shell that loads the web build. First window.
3. `Platform` service with both layers; native open/save.
4. Asset pack on GitHub Releases; bundle into the app; the web build serves them itself.
5. Game paths, Save to game (now Export to game, #132), Launch game.
6. `ballest-editor-link` plugin and Play.
7. Packaging, release workflow, updates, CI smoke.
8. Docs: VISION, README, CLAUDE.md, FORMAT's "where files live".

## Before open-sourcing (milestone 0.3)

Not desktop work, but it falls out of the same decision; tracked as issues under milestone 0.3.

- **Rights.** Confirm with the developers, in writing, that permission covers redistributing extracted meshes, textures and shaders (the asset pack) and the Workshop maps in `samples/` by other creators. Pick a license for our code (MIT like the plugin manager, or Apache-2.0); state that game assets are the game's.
- **Fork-safe CI.** `pull_request` jobs get no secrets; anything with `pull_request_target` never checks out PR code; one required check job (`Check`, `if: always()`); "require approval for first-time contributors" on Actions; branch protection on `main` (PRs only, required check, linear history). Release workflow guarded by `github.repository == 'ballest-editor/ballest-editor'`.
- **Repo hygiene.** Audit history for tokens (`.env.local`, storage tokens), rotate anything found. `CONTRIBUTING.md` (scope rules, one problem per PR, screenshots for UI), issue and PR templates, `SECURITY.md`, `CODEOWNERS`, Dependabot or Renovate.
- **Signing.** See above.
- **Vendored `repos/`.** Keep (they're MIT) but say so in a `third-party-licenses` note; add a `pnpm licenses` sync.
