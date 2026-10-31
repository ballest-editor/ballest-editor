# Desktop-first

Status: planned (milestone 0.2, GitHub project [Ballest Editor](https://github.com/orgs/ballest-editor/projects/1)). Written 2026-10-30.

The editor becomes an Electron app for Windows and Linux. The web build stays, but only as a review preview for pull requests. This page is the design; the issues under milestone 0.2 are the work.

## Why

- **Egress.** The game's meshes and textures (53 MB compressed) are served to every browser session from Vercel Blob. Once the editor is open source and public, a website would pay for that on every visit. A desktop app ships them once, inside the installer.
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
| Open a map         | `<input type=file>` | native open dialog, path remembered                          |
| Save / Save as     | download link       | native save dialog; subsequent saves overwrite               |
| Save to game       | hidden              | writes into `UserSavedMaps`                                  |
| Launch game, Play  | hidden              | `steam://rungameid/3339810`, plugin handoff                  |
| Open external link | `window.open`       | `shell.openExternal`                                         |
| Updates            | none                | electron-updater state stream                                |

`Platform.layer` is picked at module load: `window.ballest !== undefined` means desktop (the preload runs before any page script, so that test is reliable). Components still reach it through `editor/actions`; `exportMap` and `importFile` become `Platform` calls instead of DOM tricks. Settings, keybinds and map prefs stay in `localStorage` (Electron persists it under `userData`); nothing to migrate.

### Main process

Effect layers, same shape as t3-code:

- `electron/*`: one `Context.Service` per Electron API we touch (`ElectronApp`, `ElectronWindow`, `ElectronProtocol`, `ElectronDialog`, `ElectronShell`, `ElectronUpdater`). Listeners are scoped with `acquireRelease`.
- `app/`: `DesktopEnvironment` (paths: `userData`, `resourcesPath`, `isPackaged`, dev server URL from `VITE_DEV_SERVER_URL`), `DesktopApp.program` (whenReady → protocol → IPC handlers → window → updater), fatal errors to `dialog.showErrorBox`.
- `game/`: `SteamLibrary` (finds the install from `libraryfolders.vdf` + `appmanifest_3339810.acf`, like the plugin manager's `find_game.sh`), `GamePaths` (maps folder, plugins folder; Windows and Proton variants, see below), `GameLink` (play handoff).
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

Both are overridable in settings. The app never touches the install except the plugin folder below.

### Play: the plugin handoff

The [Ballest plugin manager](https://anythinggoes-ballest.github.io/ballest-plugin-manager/) runs AngelScript plugins inside the game. Its host (0.32.0) already has everything we need, so nothing has to be merged upstream:

- `Tracks::OpenLocal(name)` races a never-published `.balledit` from the maps folder as a normal race (pre-race menu, countdown, checkpoints, finish). The file is re-read on every entry, so pressing Play again picks up edits.
- `Plugins::ReadFile(path)` reads a file from the plugin's own folder, fresh each call.

So **Play** in the desktop app:

1. Saves the map into the maps folder (its `levelPublishedFileId` is -1; the host refuses anything else).
2. Writes `<plugins>/ballest-editor-link/play.json`: `{ "map": "Map_LevelEditorMain&<name>_<creator>.balledit", "nonce": <n> }`.
3. If the game isn't running (no `Ballest-Win64-Shipping.exe` process), opens `steam://rungameid/3339810`.

The plugin, `ballest-editor-link` (`packages/ballest-editor-link/`: `info.toml` + `main.as`), polls `play.json` from `Update(dt)` twice a second, and on a new nonce calls `Tracks::OpenLocal`. It uses no `Console::` and no network. It isn't published to the plugin manager's registry: the app bundles it in `extraResources` and, when the user asks, copies it into `<plugins>/ballest-editor-link/` (the plugin manager picks up a hand-installed folder when the game starts). Without the plugin manager installed, Play degrades to Save-to-game plus launch, and the editor says so.

Later: an `Editor::OpenLocal` host API for "open in the in-game editor", and a file-changed callback instead of polling. Both are upstream requests, not blockers.

### Assets

The extractor's output can't be rebuilt on CI (it needs the game). The compressed tree (`web-assets/`, meshopt + AVIF, 53 MB) is published as an **asset pack**: a tarball attached to a GitHub release tagged `assets-<tree-hash>`, with `web-assets.json` recording the tag and the tarball's SHA-256. `tools/compress/download.mjs` fetches and verifies it when `web-assets/` is missing; `//#assets` in turbo tries the local extractor output first, then the download. Desktop builds copy `assets/` (small committed files) and `web-assets/` into `extraResources`. The web build inlines the same files as static output, as today. Vercel builds through `turbo run build --filter=@ballest/web` (`apps/web/vercel.json`) so the download runs first.

Vercel Blob is retired: GitHub release downloads are free, and contributors without the game can build. `assetUrl.ts` loses its Blob branch; both platforms address assets at `/assets/*` (the protocol handler maps that on desktop).

### Packaging and release

- **electron-builder**, config generated by `tools/release/build-desktop.ts` (so it can vary by channel and signing), staged install with `pnpm install --prod`, `--publish never`; the release workflow uploads.
- **Targets:** Windows NSIS x64 (the players), Linux AppImage x64 (Proton users). No macOS: the game isn't on it.
- **Workflow `release.yml`:** on tag `v*.*.*`. Builds the JS once, then one job per target, then a release job that collects artifacts, `latest.yml` / `latest-linux.yml`, blockmaps and `SHA256SUMS`, and publishes with `softprops/action-gh-release`. Drafted until every asset is attached.
- **Updates:** `electron-updater` against GitHub Releases (`autoDownload: false`; the menu bar shows "update available → download → restart"). Disabled in dev, when unpackaged, and when `BALLEST_DISABLE_AUTO_UPDATE` is set. A mock update server (`tools/release/mock-update-server.ts`, generic provider on localhost) exercises the flow before a real release.
- **Signing:** unsigned at first (SmartScreen warns on Windows). Signing is an open-source milestone item: SignPath's OSS program or Azure Trusted Signing, done in the Windows job with env-gated secrets so fork PRs never see them.
- **CI on PRs:** build the desktop bundle unpacked on Linux and Windows runners and launch it under Xvfb for a smoke check (window appears, catalog loads). Packaging and signing only on tags.

### Dev workflow

`pnpm dev` runs the web app as now. `pnpm dev:desktop` runs vite for the renderer plus `vite build --watch` for main and preload, and a small runner (`apps/desktop/scripts/dev-electron.mjs`) that starts Electron once the bundles and the Vite port exist and restarts it when `main.cjs` or `preload.cjs` change. Main and preload are bundled to CJS with externals `electron` only (everything else bundled, as t3-code does).

Turbo: `apps/desktop#build` depends on `apps/web#build` and `//#assets`; `//#assets` gains the download fallback.

## Order of work

1. Drop TanStack Start; plain Vite SPA. Small and independently reviewable; everything else assumes it.
2. Split into `apps/web`, `apps/desktop`, `packages/contracts`; Electron shell that loads the web build. First window.
3. `Platform` service with both layers; native open/save.
4. Asset pack on GitHub Releases; bundle into the app; retire Blob.
5. Game paths, Save to game, Launch game.
6. `ballest-editor-link` plugin and Play.
7. Packaging, release workflow, updates, CI smoke.
8. Docs: VISION, README, CLAUDE.md, FORMAT's "where files live".

## Before open-sourcing (milestone 0.3)

Not desktop work, but it falls out of the same decision; tracked as issues under milestone 0.3.

- **Rights.** Confirm with the developers, in writing, that permission covers redistributing extracted meshes, textures and shaders (the asset pack) and the Workshop maps in `samples/` by other creators. Pick a license for our code (MIT like the plugin manager, or Apache-2.0); state that game assets are the game's.
- **Fork-safe CI.** `pull_request` jobs get no secrets; anything with `pull_request_target` never checks out PR code; one required check job (`Check`, `if: always()`); "require approval for first-time contributors" on Actions; branch protection on `main` (PRs only, required check, linear history). Release workflow guarded by `github.repository == 'ballest-editor/ballest-editor'`.
- **Repo hygiene.** Audit history for tokens (`.env.local`, Blob tokens), rotate anything found. `CONTRIBUTING.md` (scope rules, one problem per PR, screenshots for UI), issue and PR templates, `SECURITY.md`, `CODEOWNERS`, Dependabot or Renovate.
- **Signing.** See above.
- **Vendored `repos/`.** Keep (they're MIT) but say so in a `third-party-licenses` note; add a `pnpm licenses` sync.
