import type { Path } from "effect"
import { Option } from "effect"

// Where Steam and the game keep things (docs/DESKTOP.md § Game paths). Pure path rules: the services in this folder
// check which of these exist.

export const APP_ID = "3339810"
export const GAME_EXE = "Ballest-Win64-Shipping.exe"
/** `installdir` of the game's app manifest, used when the manifest has none. */
export const DEFAULT_INSTALL_DIR = "Ballest of Them All"
export const STEAM_LAUNCH_URL = `steam://rungameid/${APP_ID}`

/** Only the path functions these rules use, so tests can pass `node:path`'s `win32` on any OS. */
export type PathRules = Pick<Path.Path, "join" | "dirname" | "basename" | "normalize">

/** What the rules need to know about the machine. */
export interface HostInfo {
  readonly platform: NodeJS.Platform
  readonly home: string
  readonly env: { readonly [name: string]: string | undefined }
}

/** The registry keys and values Steam records its folder under, most specific first (as the plugin manager's `find_game.sh`). */
export const STEAM_REGISTRY_KEYS: ReadonlyArray<readonly [key: string, value: string]> = [
  ["HKCU\\Software\\Valve\\Steam", "SteamPath"],
  ["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"],
  ["HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"]
]

/** The data of `value` in `reg query`'s output (`    SteamPath    REG_SZ    c:/program files (x86)/steam`). */
export const regQueryValue = (output: string, value: string): Option.Option<string> => {
  const line = output.split(/\r?\n/).map((l) => l.trim()).find((l) => l.toLowerCase().startsWith(value.toLowerCase()))
  const data = line?.match(/^\S+\s+REG_(?:EXPAND_)?SZ\s+(.+)$/)?.[1]?.trim()
  return data === undefined || data.length === 0 ? Option.none() : Option.some(data)
}

/**
 * The folders Steam may be installed in. Windows: what the registry says (`registry`), then the default install
 * folders, each once. Linux: the native install (`~/.local/share/Steam`, and the `~/.steam` links to it) and the
 * Flatpak and Snap ones; the caller drops folders that resolve to the same place.
 */
export const steamRootCandidates = (
  host: HostInfo,
  registry: ReadonlyArray<string>,
  path: PathRules
): ReadonlyArray<string> => {
  if (host.platform === "win32") {
    const programFiles = [host.env["ProgramFiles(x86)"], host.env["ProgramFiles"]].flatMap((dir) =>
      dir === undefined || dir.length === 0 ? [] : [path.join(dir, "Steam")]
    )
    const all = [...registry, ...programFiles, "C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"]
    // Windows paths are case-insensitive: the registry writes Steam's folder in lower case.
    const byKey = new Map<string, string>()
    for (const dir of all.map((d) => path.normalize(d))) {
      if (!byKey.has(dir.toLowerCase())) byKey.set(dir.toLowerCase(), dir)
    }
    return [...byKey.values()]
  }
  return [
    [".local", "share", "Steam"],
    [".steam", "steam"],
    [".steam", "root"],
    [".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"],
    ["snap", "steam", "common", ".local", "share", "Steam"]
  ].map((segments) => path.join(host.home, ...segments))
}

/** The game folder inside a library. */
export const installIn = (library: string, installDir: string, path: PathRules): string =>
  path.join(library, "steamapps", "common", installDir)

export const gameExeOf = (install: string, path: PathRules): string =>
  path.join(install, "Ballest", "Binaries", "Win64", GAME_EXE)

/** The plugin manager's plugins folder, next to the game's exe. */
export const pluginsFolderOf = (install: string, path: PathRules): string =>
  path.join(install, "Ballest", "Binaries", "Win64", "plugins")

/** The plugin manager's loader, `version.dll` next to the game's exe (which loads it as a system DLL). */
export const pluginManagerDllOf = (install: string, path: PathRules): string =>
  path.join(install, "Ballest", "Binaries", "Win64", "version.dll")

/** The library an install folder sits in, when it has Steam's `<library>/steamapps/common/<dir>` shape. */
export const libraryOfInstall = (install: string, path: PathRules): Option.Option<string> => {
  const common = path.dirname(install)
  const steamapps = path.dirname(common)
  return path.basename(common).toLowerCase() === "common" && path.basename(steamapps).toLowerCase() === "steamapps"
    ? Option.some(path.dirname(steamapps))
    : Option.none()
}

/** `Ballest/Saved` under the game's local app data: the game creates it on its first run. */
const savedUnder = (localAppData: string, path: PathRules) => path.join(localAppData, "Ballest", "Saved")

/**
 * Where the game's `Saved` folder can be, most likely first; `UserSavedMaps` sits in it. Windows: the user's
 * `%LOCALAPPDATA%`. Linux: the Proton prefix Steam made for the game, in the game's library (or, when the game wasn't
 * found, in any library).
 */
export const savedFolderCandidates = (
  host: HostInfo,
  libraries: ReadonlyArray<string>,
  path: PathRules
): ReadonlyArray<string> => {
  if (host.platform === "win32") {
    const local = host.env["LOCALAPPDATA"]
    return [
      savedUnder(local !== undefined && local.length > 0 ? local : path.join(host.home, "AppData", "Local"), path)
    ]
  }
  return libraries.map((library) =>
    savedUnder(
      path.join(library, "steamapps", "compatdata", APP_ID, "pfx", "drive_c", "users", "steamuser", "AppData", "Local"),
      path
    )
  )
}

export const mapsFolderIn = (saved: string, path: PathRules): string => path.join(saved, "UserSavedMaps")
