// What a slot's prefix needs beyond a copy of the game's: the Wine override that makes it load the host, the game's
// settings for a copy nobody looks at, and the launch line. Pure, so the tests can check them.

import type { DriverPaths, SlotPaths } from "./paths.ts"

const OVERRIDES = "[Software\\\\Wine\\\\DllOverrides]"
export const VERSION_OVERRIDE = `"version"="native,builtin"`

/** Windows FILETIME now, as Wine writes `#time=` (hex of 100 ns intervals since 1601). */
const fileTimeNow = (): string => (BigInt(Date.now()) * 10000n + 116444736000000000n).toString(16)

/**
 * `user.reg` with Wine told to load the game folder's `version.dll` (the host) before its own: without
 * `"version"="native,builtin"` under `[Software\\Wine\\DllOverrides]` the host never runs. Unchanged when it's there.
 */
export const withVersionOverride = (userReg: string): string => {
  const at = userReg.indexOf(`\n${OVERRIDES}`)
  if (at < 0) {
    const header = `${OVERRIDES} ${Math.floor(Date.now() / 1000)}\n#time=${fileTimeNow()}\n${VERSION_OVERRIDE}\n`
    return `${userReg.endsWith("\n") ? userReg : `${userReg}\n`}\n${header}`
  }
  const sectionStart = at + 1
  const next = userReg.indexOf("\n[", sectionStart)
  const section = userReg.slice(sectionStart, next < 0 ? undefined : next)
  if (/^"version"=/m.test(section)) return userReg
  // after the header line and its #time line
  const headerEnd = userReg.indexOf("\n", sectionStart) + 1
  const timeEnd = userReg.startsWith("#time=", headerEnd) ? userReg.indexOf("\n", headerEnd) + 1 : headerEnd
  return `${userReg.slice(0, timeEnd)}${VERSION_OVERRIDE}\n${userReg.slice(timeEnd)}`
}

/** A copy's settings: 1280x720, windowed, everything low, 30 fps. The user's own settings never reach a slot. */
export const GAME_USER_SETTINGS = `[ScalabilityGroups]
sg.ResolutionQuality=100
sg.ViewDistanceQuality=0
sg.AntiAliasingQuality=0
sg.ShadowQuality=0
sg.GlobalIlluminationQuality=0
sg.ReflectionQuality=0
sg.PostProcessQuality=0
sg.TextureQuality=0
sg.EffectsQuality=0
sg.FoliageQuality=0
sg.ShadingQuality=0

[/Script/Engine.GameUserSettings]
bUseVSync=False
ResolutionSizeX=1280
ResolutionSizeY=720
LastUserConfirmedResolutionSizeX=1280
LastUserConfirmedResolutionSizeY=720
FullscreenMode=2
LastConfirmedFullscreenMode=2
PreferredFullscreenMode=2
FrameRateLimit=30.000000
Version=5
`

export type SlotMode = "headless" | "window"

/** The game's arguments: no window at all and the lighter renderer, or a 720p window (for looking at a copy). */
export const gameArgs = (mode: SlotMode): ReadonlyArray<string> => [
  ...(mode === "headless" ? ["-RenderOffscreen"] : ["-windowed", "-ResX=1280", "-ResY=720"]),
  "-d3d11",
  "-nosound",
  "-userdir=C:\\slot\\UserDir"
]

/**
 * umu-run's environment for a slot. `GAMEID` must be `umu-<app id>`: a bare id leaves `SteamAppId` at 0 and the
 * game's launcher asks Steam to start the real game instead (measured 2026-11-03). Wayland is unset so Wine's window,
 * when there is one, goes to the X display.
 */
export const launchEnv = (paths: DriverPaths["Service"], slot: SlotPaths): Record<string, string> => ({
  WINEPREFIX: slot.pfx,
  STEAM_COMPAT_DATA_PATH: slot.dir,
  GAMEID: "umu-3339810",
  SteamAppId: "3339810",
  SteamGameId: "3339810",
  PROTONPATH: paths.proton,
  PROTON_LOG: "1",
  PROTON_LOG_DIR: slot.dir
})

/** The marker every process of a slot carries in its environment, which is how `stop` finds them. */
export const environMarker = (slot: SlotPaths): string => `WINEPREFIX=${slot.pfx}`
