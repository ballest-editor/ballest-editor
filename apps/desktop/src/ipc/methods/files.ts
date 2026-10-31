import {
  MapFileRef,
  OpenedMapFile,
  OpenMapResult,
  ReadMapPayload,
  RecentMapFiles,
  SaveMapPayload,
  SaveMapResult,
  WriteMapPayload
} from "@ballest/contracts"
import { Effect, Option, Path, Schema } from "effect"
import { ElectronDialog } from "../../electron/ElectronDialog"
import { MAP_EXTENSIONS, MapFiles } from "../../files/MapFiles"
import {
  OPEN_MAP_CHANNEL,
  READ_MAP_CHANNEL,
  RECENT_MAPS_CHANNEL,
  SAVE_MAP_CHANNEL,
  WRITE_MAP_CHANNEL
} from "../channels"
import { makeIpcMethod } from "../DesktopIpc"

const extensions = MAP_EXTENSIONS.map((ext) => ext.slice(1))
const OPEN_FILTERS = [{ name: "Ballest maps", extensions }, { name: "All files", extensions: ["*"] }]
const SAVE_FILTERS = [{ name: "Ballest map", extensions: ["balledit"] }]

/** Where a dialog starts: the open map's folder, else the last recent file's. */
const startFolder = (near: string | undefined) =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    if (near !== undefined) return Option.some(path.dirname(near))
    const [last] = yield* (yield* MapFiles).recent
    return Option.map(Option.fromNullishOr(last), (file) => path.dirname(file.path))
  })

export const openMap = makeIpcMethod({
  channel: OPEN_MAP_CHANNEL,
  payload: Schema.Undefined,
  result: OpenMapResult,
  handler: Effect.fn("ipc.openMap")(function*(_, event) {
    const files = yield* MapFiles
    const picked = yield* (yield* ElectronDialog).showOpenFile({
      owner: event.sender.id,
      title: "Open map",
      defaultPath: yield* startFolder(undefined),
      filters: OPEN_FILTERS
    })
    if (Option.isNone(picked)) return null
    yield* files.grant(picked.value)
    return yield* files.read(picked.value)
  })
})

export const saveMap = makeIpcMethod({
  channel: SAVE_MAP_CHANNEL,
  payload: SaveMapPayload,
  result: SaveMapResult,
  handler: Effect.fn("ipc.saveMap")(function*({ name, text, near }, event) {
    const path = yield* Path.Path
    const files = yield* MapFiles
    const folder = yield* startFolder(near)
    const picked = yield* (yield* ElectronDialog).showSaveFile({
      owner: event.sender.id,
      title: "Save map",
      defaultPath: Option.some(Option.match(folder, { onNone: () => name, onSome: (dir) => path.join(dir, name) })),
      filters: SAVE_FILTERS
    })
    if (Option.isNone(picked)) return null
    yield* files.grant(picked.value)
    return yield* files.write(picked.value, text)
  })
})

export const readMap = makeIpcMethod({
  channel: READ_MAP_CHANNEL,
  payload: ReadMapPayload,
  result: OpenedMapFile,
  handler: Effect.fn("ipc.readMap")(function*({ path }) {
    return yield* (yield* MapFiles).read(path)
  })
})

export const writeMap = makeIpcMethod({
  channel: WRITE_MAP_CHANNEL,
  payload: WriteMapPayload,
  result: MapFileRef,
  handler: Effect.fn("ipc.writeMap")(function*({ path, text }) {
    return yield* (yield* MapFiles).write(path, text)
  })
})

export const recentMaps = makeIpcMethod({
  channel: RECENT_MAPS_CHANNEL,
  payload: Schema.Undefined,
  result: RecentMapFiles,
  handler: Effect.fn("ipc.recentMaps")(function*() {
    return yield* (yield* MapFiles).recent
  })
})
