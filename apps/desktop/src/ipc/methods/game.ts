import {
  ChooseGamePathResult,
  FindCreatorResult,
  type GamePathKind,
  GamePathPayload,
  GamePaths as GamePathsSchema,
  InstallPluginResult,
  PluginStatus
} from "@ballest/contracts"
import { Effect, Option, Schema } from "effect"
import { ElectronDialog } from "../../electron/ElectronDialog"
import { ElectronShell } from "../../electron/ElectronShell"
import { GameCreator } from "../../game/GameCreator"
import { GameLink } from "../../game/GameLink"
import { GamePaths } from "../../game/GamePaths"
import { GameProcess } from "../../game/GameProcess"
import {
  CHOOSE_GAME_PATH_CHANNEL,
  FIND_CREATOR_CHANNEL,
  GAME_PATHS_CHANNEL,
  INSTALL_PLUGIN_CHANNEL,
  IS_GAME_RUNNING_CHANNEL,
  LAUNCH_GAME_CHANNEL,
  PLUGIN_STATUS_CHANNEL,
  RESET_GAME_PATH_CHANNEL,
  REVEAL_GAME_PATH_CHANNEL
} from "../channels"
import { makeIpcMethod } from "../DesktopIpc"

const CHOOSE_TITLES: Record<GamePathKind, string> = {
  install: "Choose the Ballest of Them All folder",
  mapsFolder: "Choose the game's UserSavedMaps folder",
  pluginsFolder: "Choose the plugin manager's plugins folder"
}

export const gamePaths = makeIpcMethod({
  channel: GAME_PATHS_CHANNEL,
  payload: Schema.Undefined,
  result: GamePathsSchema,
  handler: Effect.fn("ipc.gamePaths")(function*() {
    return yield* (yield* GamePaths).get
  })
})

/** A folder dialog starting at the folder in use; the chosen one overrides it. */
export const chooseGamePath = makeIpcMethod({
  channel: CHOOSE_GAME_PATH_CHANNEL,
  payload: GamePathPayload,
  result: ChooseGamePathResult,
  handler: Effect.fn("ipc.chooseGamePath")(function*({ which }, event) {
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
  })
})

export const resetGamePath = makeIpcMethod({
  channel: RESET_GAME_PATH_CHANNEL,
  payload: GamePathPayload,
  result: GamePathsSchema,
  handler: Effect.fn("ipc.resetGamePath")(function*({ which }) {
    return yield* (yield* GamePaths).setOverride(which, Option.none())
  })
})

/** Only the three game folders can be shown this way, and only when they exist. */
export const revealGamePath = makeIpcMethod({
  channel: REVEAL_GAME_PATH_CHANNEL,
  payload: GamePathPayload,
  result: Schema.Boolean,
  handler: Effect.fn("ipc.revealGamePath")(function*({ which }) {
    const { status, path } = (yield* (yield* GamePaths).get)[which]
    if (status === "missing" || path === null) return false
    return yield* (yield* ElectronShell).openFolder(path)
  })
})

export const launchGame = makeIpcMethod({
  channel: LAUNCH_GAME_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Boolean,
  handler: Effect.fn("ipc.launchGame")(function*() {
    return yield* (yield* ElectronShell).launchGame
  })
})

export const isGameRunning = makeIpcMethod({
  channel: IS_GAME_RUNNING_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Boolean,
  handler: Effect.fn("ipc.isGameRunning")(function*() {
    return yield* (yield* GameProcess).isRunning
  })
})

export const findCreator = makeIpcMethod({
  channel: FIND_CREATOR_CHANNEL,
  payload: Schema.Undefined,
  result: FindCreatorResult,
  handler: Effect.fn("ipc.findCreator")(function*() {
    return Option.getOrNull(yield* (yield* GameCreator).find)
  })
})

export const pluginStatus = makeIpcMethod({
  channel: PLUGIN_STATUS_CHANNEL,
  payload: Schema.Undefined,
  result: PluginStatus,
  handler: Effect.fn("ipc.pluginStatus")(function*() {
    return yield* (yield* GameLink).pluginStatus
  })
})

/** Only when the user asks (Install / Update); nothing installs or updates the plugin on its own. */
export const installPlugin = makeIpcMethod({
  channel: INSTALL_PLUGIN_CHANNEL,
  payload: Schema.Undefined,
  result: InstallPluginResult,
  handler: Effect.fn("ipc.installPlugin")(function*() {
    return yield* (yield* GameLink).installPlugin
  })
})
