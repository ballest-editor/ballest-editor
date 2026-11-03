import { Effect, Option, Path } from "effect"
import { ElectronDialog } from "../../electron/ElectronDialog"
import { ElectronShell } from "../../electron/ElectronShell"
import { GamePaths } from "../../game/GamePaths"
import { MAP_EXTENSIONS } from "../../project/files"
import { Projects } from "../../project/Projects"
import type { DesktopIpcHandlers } from "../DesktopIpc"

const IMPORT_FILTERS = [
  { name: "Ballest maps", extensions: MAP_EXTENSIONS.map((ext) => ext.slice(1)) },
  { name: "All files", extensions: ["*"] }
]

export const projectHandlers = {
  projectState: Effect.fn("ipc.projectState")(function*() {
    return yield* (yield* Projects).state
  }),
  /** A folder dialog starting at the project in use; the chosen folder becomes the project. */
  chooseProject: Effect.fn("ipc.chooseProject")(function*(_, event) {
    const projects = yield* Projects
    const { current, projectsFolder } = yield* projects.state
    const picked = yield* (yield* ElectronDialog).showOpenFolder({
      owner: event.sender.id,
      title: "Choose the project folder",
      // the project in use, or where projects are made; a folder that isn't a project yet starts in its parent
      defaultPath: Option.some(
        current === null ? projectsFolder : current.exists ? current.path : (yield* Path.Path).dirname(current.path)
      ),
      filters: []
    })
    if (Option.isNone(picked)) return null
    return yield* projects.use(picked.value)
  }),
  switchProject: Effect.fn("ipc.switchProject")(function*({ path }) {
    return yield* (yield* Projects).switchTo(path)
  }),
  /** New project: `<projectsFolder>/<name>`, made and used. */
  createProject: Effect.fn("ipc.createProject")(function*({ name }) {
    return yield* (yield* Projects).createNew(name)
  }),
  revealProject: Effect.fn("ipc.revealProject")(function*({ which }) {
    const folder = yield* (yield* Projects).folderOf(which)
    if (Option.isNone(folder)) return false
    return yield* (yield* ElectronShell).openFolder(folder.value)
  }),
  /** Project settings › General: the project's name. */
  renameProject: Effect.fn("ipc.renameProject")(function*({ name }) {
    return yield* (yield* Projects).setName(name)
  }),
  /** Keeps which map is open in the project, so the next launch opens it again. */
  rememberOpenMap: Effect.fn("ipc.rememberOpenMap")(function*({ fileName }) {
    yield* (yield* Projects).rememberOpenMap(fileName)
  }),
  listMaps: Effect.fn("ipc.listMaps")(function*() {
    return yield* (yield* Projects).list
  }),
  readMap: Effect.fn("ipc.readMap")(function*({ fileName }) {
    return yield* (yield* Projects).read(fileName)
  }),
  createMap: Effect.fn("ipc.createMap")(function*({ fileName, text }) {
    return yield* (yield* Projects).create(fileName, text)
  }),
  saveMap: Effect.fn("ipc.saveMap")(function*({ fileName, text }) {
    return yield* (yield* Projects).save(fileName, text)
  }),
  renameMap: Effect.fn("ipc.renameMap")(function*({ from, to, text }) {
    return yield* (yield* Projects).rename(from, to, text)
  }),
  /** The open dialog, starting in the game's maps folder when it is found. */
  pickImport: Effect.fn("ipc.pickImport")(function*(_, event) {
    const { mapsFolder } = yield* (yield* GamePaths).get
    const picked = yield* (yield* ElectronDialog).showOpenFile({
      owner: event.sender.id,
      title: "Import a map",
      defaultPath: Option.fromNullOr(mapsFolder.status === "missing" ? null : mapsFolder.path),
      filters: IMPORT_FILTERS
    })
    if (Option.isNone(picked)) return null
    return yield* (yield* Projects).pick(picked.value)
  }),
  importMap: Effect.fn("ipc.importMap")(function*(payload) {
    return yield* (yield* Projects).importMap(payload)
  }),
  exportMap: Effect.fn("ipc.exportMap")(function*(payload) {
    return yield* (yield* Projects).exportMap(payload)
  }),
  /** Sync detection: the exports the game changed since the last look, and the ones gone (docs/PROJECTS.md § Sync). */
  checkExports: Effect.fn("ipc.checkExports")(function*() {
    return yield* (yield* Projects).checkExports
  }),
  reimportMap: Effect.fn("ipc.reimportMap")(function*({ fileName }) {
    return yield* (yield* Projects).reimportMap(fileName)
  }),
  listBackups: Effect.fn("ipc.listBackups")(function*() {
    return yield* (yield* Projects).backups
  }),
  readBackup: Effect.fn("ipc.readBackup")(function*(ref) {
    return yield* (yield* Projects).readBackup(ref)
  })
} satisfies Partial<DesktopIpcHandlers>
