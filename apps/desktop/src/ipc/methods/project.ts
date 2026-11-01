import {
  BackupRef,
  ChooseProjectResult,
  ExportChecks,
  ExportMapPayload,
  ExportMapResult,
  ImportMapPayload,
  ImportMapResult,
  MapBackupFile,
  MapBackups,
  MapFileNamePayload,
  PickImportResult,
  ProjectMap,
  ProjectMapFile,
  ProjectMaps,
  ProjectPathPayload,
  ProjectState,
  RenameMapPayload,
  WriteMapPayload
} from "@ballest/contracts"
import { Effect, Option, Path, Schema } from "effect"
import { ElectronDialog } from "../../electron/ElectronDialog"
import { ElectronShell } from "../../electron/ElectronShell"
import { GamePaths } from "../../game/GamePaths"
import { MAP_EXTENSIONS } from "../../project/files"
import { Projects } from "../../project/Projects"
import {
  CHECK_EXPORTS_CHANNEL,
  CHOOSE_PROJECT_CHANNEL,
  CREATE_MAP_CHANNEL,
  EXPORT_MAP_CHANNEL,
  IMPORT_MAP_CHANNEL,
  LIST_BACKUPS_CHANNEL,
  LIST_MAPS_CHANNEL,
  PICK_IMPORT_CHANNEL,
  PROJECT_STATE_CHANNEL,
  READ_BACKUP_CHANNEL,
  READ_MAP_CHANNEL,
  REIMPORT_MAP_CHANNEL,
  RENAME_MAP_CHANNEL,
  REVEAL_PROJECT_CHANNEL,
  SAVE_MAP_CHANNEL,
  SWITCH_PROJECT_CHANNEL
} from "../channels"
import { makeIpcMethod } from "../DesktopIpc"

const IMPORT_FILTERS = [
  { name: "Ballest maps", extensions: MAP_EXTENSIONS.map((ext) => ext.slice(1)) },
  { name: "All files", extensions: ["*"] }
]

export const projectState = makeIpcMethod({
  channel: PROJECT_STATE_CHANNEL,
  payload: Schema.Undefined,
  result: ProjectState,
  handler: Effect.fn("ipc.projectState")(function*() {
    return yield* (yield* Projects).state
  })
})

/** A folder dialog starting at the project in use; the chosen folder becomes the project. */
export const chooseProject = makeIpcMethod({
  channel: CHOOSE_PROJECT_CHANNEL,
  payload: Schema.Undefined,
  result: ChooseProjectResult,
  handler: Effect.fn("ipc.chooseProject")(function*(_, event) {
    const projects = yield* Projects
    const { current } = yield* projects.state
    const picked = yield* (yield* ElectronDialog).showOpenFolder({
      owner: event.sender.id,
      title: "Choose the project folder",
      defaultPath: Option.some(current.exists ? current.path : (yield* Path.Path).dirname(current.path)),
      filters: []
    })
    if (Option.isNone(picked)) return null
    return yield* projects.use(picked.value)
  })
})

export const switchProject = makeIpcMethod({
  channel: SWITCH_PROJECT_CHANNEL,
  payload: ProjectPathPayload,
  result: ProjectState,
  handler: Effect.fn("ipc.switchProject")(function*({ path }) {
    return yield* (yield* Projects).switchTo(path)
  })
})

export const revealProject = makeIpcMethod({
  channel: REVEAL_PROJECT_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Boolean,
  handler: Effect.fn("ipc.revealProject")(function*() {
    const folder = yield* (yield* Projects).mapsFolder
    if (Option.isNone(folder)) return false
    return yield* (yield* ElectronShell).openFolder(folder.value)
  })
})

export const listMaps = makeIpcMethod({
  channel: LIST_MAPS_CHANNEL,
  payload: Schema.Undefined,
  result: ProjectMaps,
  handler: Effect.fn("ipc.listMaps")(function*() {
    return yield* (yield* Projects).list
  })
})

export const readMap = makeIpcMethod({
  channel: READ_MAP_CHANNEL,
  payload: MapFileNamePayload,
  result: ProjectMapFile,
  handler: Effect.fn("ipc.readMap")(function*({ fileName }) {
    return yield* (yield* Projects).read(fileName)
  })
})

export const createMap = makeIpcMethod({
  channel: CREATE_MAP_CHANNEL,
  payload: WriteMapPayload,
  result: ProjectMap,
  handler: Effect.fn("ipc.createMap")(function*({ fileName, text }) {
    return yield* (yield* Projects).create(fileName, text)
  })
})

export const saveMap = makeIpcMethod({
  channel: SAVE_MAP_CHANNEL,
  payload: WriteMapPayload,
  result: ProjectMap,
  handler: Effect.fn("ipc.saveMap")(function*({ fileName, text }) {
    return yield* (yield* Projects).save(fileName, text)
  })
})

export const renameMap = makeIpcMethod({
  channel: RENAME_MAP_CHANNEL,
  payload: RenameMapPayload,
  result: ProjectMap,
  handler: Effect.fn("ipc.renameMap")(function*({ from, to, text }) {
    return yield* (yield* Projects).rename(from, to, text)
  })
})

/** The open dialog, starting in the game's maps folder when it is found. */
export const pickImport = makeIpcMethod({
  channel: PICK_IMPORT_CHANNEL,
  payload: Schema.Undefined,
  result: PickImportResult,
  handler: Effect.fn("ipc.pickImport")(function*(_, event) {
    const { mapsFolder } = yield* (yield* GamePaths).get
    const picked = yield* (yield* ElectronDialog).showOpenFile({
      owner: event.sender.id,
      title: "Import a map",
      defaultPath: Option.fromNullOr(mapsFolder.status === "missing" ? null : mapsFolder.path),
      filters: IMPORT_FILTERS
    })
    if (Option.isNone(picked)) return null
    return yield* (yield* Projects).pick(picked.value)
  })
})

export const importMap = makeIpcMethod({
  channel: IMPORT_MAP_CHANNEL,
  payload: ImportMapPayload,
  result: ImportMapResult,
  handler: Effect.fn("ipc.importMap")(function*(payload) {
    return yield* (yield* Projects).importMap(payload)
  })
})

export const exportMap = makeIpcMethod({
  channel: EXPORT_MAP_CHANNEL,
  payload: ExportMapPayload,
  result: ExportMapResult,
  handler: Effect.fn("ipc.exportMap")(function*(payload) {
    return yield* (yield* Projects).exportMap(payload)
  })
})

/** Sync detection: the exports the game changed since the last look, and the ones gone (docs/PROJECTS.md § Sync). */
export const checkExports = makeIpcMethod({
  channel: CHECK_EXPORTS_CHANNEL,
  payload: Schema.Undefined,
  result: ExportChecks,
  handler: Effect.fn("ipc.checkExports")(function*() {
    return yield* (yield* Projects).checkExports
  })
})

export const reimportMap = makeIpcMethod({
  channel: REIMPORT_MAP_CHANNEL,
  payload: MapFileNamePayload,
  result: ProjectMapFile,
  handler: Effect.fn("ipc.reimportMap")(function*({ fileName }) {
    return yield* (yield* Projects).reimportMap(fileName)
  })
})

export const listBackups = makeIpcMethod({
  channel: LIST_BACKUPS_CHANNEL,
  payload: Schema.Undefined,
  result: MapBackups,
  handler: Effect.fn("ipc.listBackups")(function*() {
    return yield* (yield* Projects).backups
  })
})

export const readBackup = makeIpcMethod({
  channel: READ_BACKUP_CHANNEL,
  payload: BackupRef,
  result: MapBackupFile,
  handler: Effect.fn("ipc.readBackup")(function*(ref) {
    return yield* (yield* Projects).readBackup(ref)
  })
})
