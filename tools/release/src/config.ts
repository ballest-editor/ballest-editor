// The staged app's package.json, whose `build` block is the electron-builder config (docs/DESKTOP.md § Packaging).
import type { Configuration } from "electron-builder"

export type Platform = "win" | "linux"
export const platforms: ReadonlyArray<Platform> = ["win", "linux"]

/** Where the update feed lives. electron-builder only records it (app-update.yml, latest*.yml); the workflow uploads. */
export const repository = { owner: "ballest-editor", repo: "ballest-editor" } as const

export const productName = "Ballest Editor"

/** The installer or AppImage a platform's build must produce, named by `artifactName` (AppImage says x86_64). */
export const installerName = (platform: Platform, version: string) =>
  platform === "win" ? `Ballest-Editor-${version}-x64.exe` : `Ballest-Editor-${version}-x86_64.AppImage`

/**
 * Every file a platform's build uploads: the installer, its blockmap for differential updates (the AppImage embeds
 * its own), and the update manifest.
 */
export const releaseFiles = (platform: Platform, version: string) =>
  platform === "win"
    ? [installerName(platform, version), `${installerName(platform, version)}.blockmap`, updateManifestName(platform)]
    : [installerName(platform, version), updateManifestName(platform)]

/** electron-updater's feed for each platform: `latest.yml` on Windows, `latest-linux.yml` on Linux. */
export const updateManifestName = (platform: Platform) => platform === "win" ? "latest.yml" : "latest-linux.yml"

/** Directories inside the staged app, relative to it. */
export const stageLayout = {
  /** `dist-electron/` of apps/desktop: main.cjs and preload.cjs. */
  main: "dist-electron",
  /** apps/web/dist minus the game assets; `DesktopEnvironment.rendererDir` is `<app.asar>/web`. */
  renderer: "web",
  /** The game assets, shipped beside app.asar as `resources/assets` (`DesktopEnvironment.assetsDir`). */
  assets: "assets",
  /** Icons, generated from apps/desktop/resources/icon.svg. */
  buildResources: "build"
} as const

export const builderConfig = (options: {
  readonly platform: Platform
  readonly electronVersion: string
  readonly output: string
}): Configuration => ({
  appId: "com.spigelli.ballest-editor",
  productName,
  artifactName: "Ballest-Editor-${version}-${arch}.${ext}",
  electronVersion: options.electronVersion,
  directories: { output: options.output, buildResources: stageLayout.buildResources },
  // The bundles carry their dependencies (apps/desktop/vite.config.ts), so the staged app has none to collect.
  files: [
    "package.json",
    `${stageLayout.main}/**`,
    `${stageLayout.renderer}/**`,
    "!**/*.map",
    "!**/*.d.ts"
  ],
  extraResources: [{ from: stageLayout.assets, to: "assets" }],
  npmRebuild: false,
  electronLanguages: ["en-US"],
  publish: [{ provider: "github", ...repository }],
  ...(options.platform === "win"
    ? {
      win: { target: [{ target: "nsis", arch: ["x64"] }], icon: "icon.ico" },
      nsis: { differentialPackage: true, oneClick: false, allowToChangeInstallationDirectory: true }
    }
    : {
      // The static AppImage runtime, so hosts with only FUSE 3 (most current distros) don't need libfuse2.
      toolsets: { appimage: "1.0.3" },
      linux: {
        target: [{ target: "AppImage", arch: ["x64"] }],
        category: "Game",
        executableName: "ballest-editor",
        // Names the .desktop file after package.json's desktopName, which Electron reports as the window's class.
        syncDesktopName: true,
        icon: "icons",
        synopsis: "Map editor for Ballest of Them All"
      }
    })
})

export const stagePackageJson = (options: {
  readonly platform: Platform
  readonly version: string
  readonly electronVersion: string
  readonly output: string
}) => ({
  name: "ballest-editor",
  productName,
  version: options.version,
  description: "Map editor for Ballest of Them All",
  author: "Ballest Editor contributors",
  homepage: `https://github.com/${repository.owner}/${repository.repo}`,
  private: true,
  main: `${stageLayout.main}/main.cjs`,
  desktopName: "ballest-editor.desktop",
  build: builderConfig(options)
})
