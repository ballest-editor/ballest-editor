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

The extractor's output can't be rebuilt on CI (it needs the game). The compressed tree (`web-assets/`, meshopt + AVIF, 53 MB) is published as an **asset pack**: a tarball attached to a GitHub release tagged `assets-<tree-hash>`, with `web-assets.json` recording the tag and the tarball's SHA-256. `tools/compress/download.mjs` fetches and verifies it when `web-assets/` is missing; `//#assets` in turbo tries the local extractor output first, then the download. Desktop builds copy `assets/` (small committed files) and `web-assets/` into `extraResources`. The web build inlines the same files as static output. Vercel builds it through `turbo run build --filter=@ballest/web` (`apps/web/vercel.json`) so the download runs first.

Release downloads are free, and contributors without the game can build. `assetUrl.ts` addresses every asset at `/assets/*` on both platforms (the protocol handler maps that on desktop).

### Packaging and release

- **electron-builder**, run by `tools/release` (`pnpm dist:desktop:win|linux`; [tools/release/README.md](../tools/release/README.md)). It stages the app in a temp directory with a generated `package.json` whose `build` block is the config (so it can vary by platform, and later by channel and signing), and runs `--publish never`; the release workflow uploads. The staged app has no `node_modules` (main and preload inline their dependencies), the game assets go to `extraResources`, and the icons are rendered from `apps/desktop/resources/icon.svg`.
- **Targets:** Windows NSIS x64 (the players), Linux AppImage x64 (Proton users). No macOS: the game isn't on it.
- **Workflow `release.yml`:** on tag `v*.*.*` (or by hand with a tag), only in `ballest-editor/ballest-editor`. Builds the JS once, then one job per target (`release-desktop.yml`), then a release job that checks the installers, the Windows blockmap and `latest.yml` / `latest-linux.yml` against the version, writes `SHA256SUMS`, and publishes with `softprops/action-gh-release`. Drafted until every asset is attached; `-rc.N` tags are prereleases, never "latest".
- **Updates:** `electron-updater` against GitHub Releases (`autoDownload: false`; the menu bar shows "update available → download → restart"). Disabled in dev, when unpackaged, and when `BALLEST_DISABLE_AUTO_UPDATE` is set. A mock update server (`tools/release/mock-update-server.ts`, generic provider on localhost) exercises the flow before a real release.
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
5. Game paths, Save to game, Launch game.
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
