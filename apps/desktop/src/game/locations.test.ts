import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import * as NodePath from "node:path"
import {
  gameExeOf,
  type HostInfo,
  libraryOfInstall,
  mapsFolderIn,
  pluginsFolderOf,
  regQueryValue,
  savedFolderCandidates,
  steamRootCandidates
} from "./locations"

const win = NodePath.win32
const posix = NodePath.posix

const windowsHost: HostInfo = {
  platform: "win32",
  home: "C:\\Users\\player",
  env: {
    "LOCALAPPDATA": "C:\\Users\\player\\AppData\\Local",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    "ProgramFiles": "C:\\Program Files"
  }
}

const linuxHost: HostInfo = { platform: "linux", home: "/home/player", env: {} }

describe("game locations", () => {
  it("reads Steam's folder from reg query output", () => {
    const output =
      "\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n\r\n"
    assert.deepStrictEqual(regQueryValue(output, "SteamPath"), Option.some("c:/program files (x86)/steam"))
    assert.deepStrictEqual(regQueryValue(output, "InstallPath"), Option.none())
    assert.deepStrictEqual(
      regQueryValue("ERROR: The system was unable to find the specified registry key", "SteamPath"),
      Option.none()
    )
  })

  it("looks for Steam where the registry says, then in Program Files", () => {
    assert.deepStrictEqual(steamRootCandidates(windowsHost, ["c:/program files (x86)/steam", "D:\\Steam"], win), [
      "c:\\program files (x86)\\steam",
      "D:\\Steam",
      "C:\\Program Files\\Steam"
    ])
  })

  it("looks for Steam in the native, Flatpak and Snap folders on Linux", () => {
    assert.deepStrictEqual(steamRootCandidates(linuxHost, [], posix), [
      "/home/player/.local/share/Steam",
      "/home/player/.steam/steam",
      "/home/player/.steam/root",
      "/home/player/.var/app/com.valvesoftware.Steam/.local/share/Steam",
      "/home/player/snap/steam/common/.local/share/Steam"
    ])
  })

  it("finds the exe and plugins folder inside the install", () => {
    const install = "D:\\SteamLibrary\\steamapps\\common\\Ballest of Them All"
    assert.strictEqual(
      gameExeOf(install, win),
      "D:\\SteamLibrary\\steamapps\\common\\Ballest of Them All\\Ballest\\Binaries\\Win64\\Ballest-Win64-Shipping.exe"
    )
    assert.strictEqual(
      pluginsFolderOf(install, win),
      "D:\\SteamLibrary\\steamapps\\common\\Ballest of Them All\\Ballest\\Binaries\\Win64\\plugins"
    )
  })

  it("tells the library from an install folder that has Steam's shape", () => {
    assert.deepStrictEqual(
      libraryOfInstall("/mnt/games/SteamLibrary/steamapps/common/Ballest of Them All", posix),
      Option.some("/mnt/games/SteamLibrary")
    )
    assert.deepStrictEqual(
      libraryOfInstall("D:\\SteamLibrary\\SteamApps\\Common\\Ballest", win),
      Option.some("D:\\SteamLibrary")
    )
    assert.deepStrictEqual(libraryOfInstall("/opt/ballest", posix), Option.none())
  })

  it("puts the maps folder in LOCALAPPDATA on Windows", () => {
    assert.deepStrictEqual(
      savedFolderCandidates(windowsHost, ["D:\\SteamLibrary"], win).map((saved) => mapsFolderIn(saved, win)),
      ["C:\\Users\\player\\AppData\\Local\\Ballest\\Saved\\UserSavedMaps"]
    )
    assert.deepStrictEqual(savedFolderCandidates({ ...windowsHost, env: {} }, [], win), [
      "C:\\Users\\player\\AppData\\Local\\Ballest\\Saved"
    ])
  })

  it("puts the maps folder in each library's Proton prefix on Linux", () => {
    assert.deepStrictEqual(
      savedFolderCandidates(linuxHost, ["/mnt/games/SteamLibrary", "/home/player/.local/share/Steam"], posix).map((
        saved
      ) => mapsFolderIn(saved, posix)),
      [
        "/mnt/games/SteamLibrary/steamapps/compatdata/3339810/pfx/drive_c/users/steamuser/AppData/Local/Ballest/Saved/UserSavedMaps",
        "/home/player/.local/share/Steam/steamapps/compatdata/3339810/pfx/drive_c/users/steamuser/AppData/Local/Ballest/Saved/UserSavedMaps"
      ]
    )
  })
})
