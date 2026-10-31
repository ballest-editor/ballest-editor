# tools/release: installers and releases

Packages the desktop app with [electron-builder](https://www.electron.build) and checks a release before it's published. The design is in [docs/DESKTOP.md](../../docs/DESKTOP.md) § Packaging and release. Like `tools/extract`, it's an Effect CLI that Node runs straight from the TypeScript.

```sh
pnpm dist:desktop:linux     # release/Ballest-Editor-<version>-x86_64.AppImage + latest-linux.yml
pnpm dist:desktop:win       # release/Ballest-Editor-<version>-x64.exe + .blockmap + latest.yml (Wine off Windows)
pnpm release:smoke          # stage the current build, lay it out unpacked, check it (release.yml runs this)

node tools/release/src/main.ts --help
```

`desktop` takes `--app-version` (a version or a tag; defaults to `apps/desktop/package.json`'s), `--output` (default `release/`) and `--skip-build`. Builds are unsigned, and electron-builder never publishes: uploading is the release workflow's job.

## What `desktop` does

1. `turbo run build --filter=@ballest/desktop`: the asset pack, `apps/web/dist`, `apps/desktop/dist-electron`. Cached as usual.
2. Stages the app in a temp directory:

   | Staged           | From                                                              | Ships as                         |
   | ---------------- | ----------------------------------------------------------------- | -------------------------------- |
   | `package.json`   | `src/config.ts`; its `build` block is the electron-builder config | read by electron-builder         |
   | `dist-electron/` | `apps/desktop/dist-electron` (main.cjs, preload.cjs)              | `app.asar`                       |
   | `web/`           | `apps/web/dist` without the game assets                           | `app.asar`                       |
   | `assets/`        | `assets/` (minus raw `pieces/`, `textures/`) + `web-assets/`      | `resources/assets`               |
   | `build/`         | `apps/desktop/resources/icon.svg`, rendered by `src/icons.ts`     | exe, installer and desktop icons |

   `DesktopEnvironment` reads the renderer from `<app.asar>/web` and the assets from `resources/assets` when packaged, so the 53 MB of meshes and textures ship once. There is no `node_modules`: the main and preload bundles inline every dependency except `electron`.
3. `electron-builder --<platform> --x64 --publish never`, with `CSC_IDENTITY_AUTO_DISCOVERY=false`.
4. Checks the output the way the release job will (below), for that platform only.

The NSIS installer is assisted (pick a directory) with differential updates; the AppImage uses the static runtime (`toolsets.appimage`), so hosts with only FUSE 3 run it. `publish` names this repository so electron-builder writes `app-update.yml` and the `latest*.yml` feeds for electron-updater (#68).

## Releasing

Push a tag: `git tag v0.2.0-rc.1 && git push origin v0.2.0-rc.1`, or run the **Release** workflow by hand with a tag (created on the branch's head if new). `.github/workflows/release.yml`, only in `ballest-editor/ballest-editor`:

1. **build bundle** checks the tag is `vX.Y.Z` or `vX.Y.Z-pre` (`main.ts version`), builds once, runs the smoke check and uploads `apps/web/dist`, `apps/desktop/dist-electron` and `web-assets/`.
2. **desktop win x64** (`windows-latest`) and **desktop linux x64** (`ubuntu-latest`) run `release-desktop.yml`, which packages with `--skip-build` and uploads the installer, blockmap and manifest.
3. **publish release** runs `main.ts verify`: both installers, the Windows blockmap and both manifests exist, the manifests are for this version and point at files that exist. It writes `SHA256SUMS` and uploads everything to a draft release, then publishes it. A version with a pre-release part (`-rc.1`) is a GitHub prerelease and never "latest".

The app's version is the tag's. `apps/desktop/package.json`'s version is only for local builds and `pnpm start`.
