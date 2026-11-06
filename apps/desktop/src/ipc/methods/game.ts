import type { GamePathKind } from "@ballest/contracts"
import { Effect, Option } from "effect"
import { ElectronDialog } from "../../electron/ElectronDialog"
import { ElectronShell } from "../../electron/ElectronShell"
import { GameCreator } from "../../game/GameCreator"
import { GameLink } from "../../game/GameLink"
import { GamePaths } from "../../game/GamePaths"
import { GamePlay } from "../../game/GamePlay"
import { GameProcess } from "../../game/GameProcess"
import type { DesktopIpcHandlers } from "../DesktopIpc"

const CHOOSE_TITLES: Record<GamePathKind, string> = {
  install: "Choose the Ballest of Them All folder",
  mapsFolder: "Choose the game's UserSavedMaps folder",
  pluginsFolder: "Choose the plugin manager's plugins folder"
}

export const gameHandlers = {
  gamePaths: Effect.fn("ipc.gamePaths")(function*() {
    return yield* (yield* GamePaths).get
  }),
  /** A folder dialog starting at the folder in use; the chosen one overrides it. */
  chooseGamePath: Effect.fn("ipc.chooseGamePath")(function*({ which }, event) {
    const paths = yield* GamePaths
    const current = (yield* paths.get)[which]
    const picked = yield* (yield* ElectronDialog).showOpenFolder({
      owner: event.sender.id,
      title: CHOOSE_TITLES[which],
      defaultPath: Option.fromNullOr(current.status === "missing" ? null : current.path),
      filters: []
    })
    if (Option.isNone(picked)) return null
    return yield* paths.setOverride(which, picked)
  }),
  resetGamePath: Effect.fn("ipc.resetGamePath")(function*({ which }) {
    return yield* (yield* GamePaths).setOverride(which, Option.none())
  }),
  /** Only the three game folders can be shown this way, and only when they exist. */
  revealGamePath: Effect.fn("ipc.revealGamePath")(function*({ which }) {
    const { status, path } = (yield* (yield* GamePaths).get)[which]
    if (status === "missing" || path === null) return false
    return yield* (yield* ElectronShell).openFolder(path)
  }),
  launchGame: Effect.fn("ipc.launchGame")(function*() {
    return yield* (yield* ElectronShell).launchGame
  }),
  isGameRunning: Effect.fn("ipc.isGameRunning")(function*() {
    return yield* (yield* GameProcess).isRunning
  }),
  findCreator: Effect.fn("ipc.findCreator")(function*() {
    return Option.getOrNull(yield* (yield* GameCreator).find)
  }),
  pluginStatus: Effect.fn("ipc.pluginStatus")(function*() {
    return yield* (yield* GameLink).pluginStatus
  }),
  /** Only when the user asks (Install / Update); nothing installs or updates the plugin on its own. */
  installPlugin: Effect.fn("ipc.installPlugin")(function*() {
    return yield* (yield* GameLink).installPlugin
  }),
  /** Export to game, then the plugin handoff and the game (docs/DESKTOP.md § Play). */
  play: Effect.fn("ipc.play")(function*(payload) {
    return yield* (yield* GamePlay).play(payload)
  }),
  /** Export to game, then the plugin opens it in the in-game editor (docs/DESKTOP.md § Play). */
  openInGame: Effect.fn("ipc.openInGame")(function*(payload) {
    return yield* (yield* GamePlay).openInGame(payload)
  })
} satisfies Partial<DesktopIpcHandlers>
