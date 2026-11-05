import { Config, Context, Effect, Layer, Option, Path } from "effect"
import { ElectronApp } from "../electron/ElectronApp"
import { parseProjectArg } from "../window/launchArgs"

/** Where things are, decided once at startup. Everything else asks this service instead of Electron or `process`. */
export class DesktopEnvironment extends Context.Service<DesktopEnvironment, {
  readonly isPackaged: boolean
  readonly platform: NodeJS.Platform
  /** `VITE_DEV_SERVER_URL`, set by the dev runner: the renderer is proxied from Vite instead of read from disk. */
  readonly devServerUrl: Option.Option<URL>
  readonly isDevelopment: boolean
  readonly appVersion: string
  readonly userData: string
  /** `userData/desktop-settings.json`: window bounds and other main-process state. */
  readonly settingsPath: string
  /** `userData/backups`: the files Export wrote over in the game's maps folder (project/Backups.ts). */
  readonly exportBackupsDir: string
  /** `userData/notifications.json`: the bell's last notifications. */
  readonly notificationsPath: string
  /** `userData/windows`: one file per running copy, saying what it has open (project/WindowRegistry.ts). */
  readonly windowsDir: string
  /** The `--project` this copy was started with, as given: what New window asks for (window/launchArgs.ts). */
  readonly launchProject: Option.Option<string>
  /** `Documents/Ballest Editor`: where New project and the first Save make project folders (docs/PROJECTS.md). */
  readonly projectsDir: string
  readonly preloadPath: string
  /** The window's icon: `icon.png`, rendered from `resources/icon.svg` by the build next to `main.cjs`. */
  readonly iconPath: string
  /** The renderer build (`apps/web/dist`, or its copy inside `app.asar`). */
  readonly rendererDir: string
  /** The game-derived assets, served at `/assets/*` next to the renderer's own chunks; none when unpackaged. */
  readonly assetsDir: Option.Option<string>
  /**
   * The `ballest-editor-link` plugin the app installs into the game (`resources/plugins/ballest-editor-link`;
   * unpackaged, packages/ballest-editor-link's build).
   */
  readonly pluginDir: string
}>()("ballest/desktop/app/DesktopEnvironment") {
  /** `dirname` is the bundle's directory (`dist-electron/`), where the preload sits next to `main.cjs`. */
  static readonly layer = (dirname: string) =>
    Layer.effect(
      DesktopEnvironment,
      Effect.gen(function*() {
        const path = yield* Path.Path
        const metadata = yield* (yield* ElectronApp).metadata
        const devServerUrl = yield* Config.URL("VITE_DEV_SERVER_URL").pipe(Config.option)
        return DesktopEnvironment.of({
          isPackaged: metadata.isPackaged,
          platform: process.platform,
          devServerUrl,
          isDevelopment: Option.isSome(devServerUrl),
          appVersion: metadata.appVersion,
          userData: metadata.userData,
          settingsPath: path.join(metadata.userData, "desktop-settings.json"),
          exportBackupsDir: path.join(metadata.userData, "backups"),
          notificationsPath: path.join(metadata.userData, "notifications.json"),
          windowsDir: path.join(metadata.userData, "windows"),
          launchProject: parseProjectArg(process.argv),
          projectsDir: path.join(metadata.documents, "Ballest Editor"),
          preloadPath: path.join(dirname, "preload.cjs"),
          iconPath: path.join(dirname, "icon.png"),
          // Unpackaged, `vite build` of apps/web has already copied the assets into dist/assets.
          rendererDir: metadata.isPackaged
            ? path.join(metadata.appPath, "web")
            : path.resolve(dirname, "../../web/dist"),
          assetsDir: metadata.isPackaged ? Option.some(path.join(metadata.resourcesPath, "assets")) : Option.none(),
          pluginDir: metadata.isPackaged
            ? path.join(metadata.resourcesPath, "plugins", "ballest-editor-link")
            : path.resolve(dirname, "../../../packages/ballest-editor-link/dist/ballest-editor-link")
        })
      })
    )
}
