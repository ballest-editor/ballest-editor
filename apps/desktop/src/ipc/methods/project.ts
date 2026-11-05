import { MAP_EXTENSIONS } from "@ballest/contracts"
import { Effect, Option, Path } from "effect"
import { ElectronDialog } from "../../electron/ElectronDialog"
import { ElectronShell } from "../../electron/ElectronShell"
import { GamePaths } from "../../game/GamePaths"
import { MapExports } from "../../project/MapExports"
import { MapFiles } from "../../project/MapFiles"
import { Prefabs } from "../../project/Prefabs"
import { Projects } from "../../project/Projects"
import { WindowLauncher } from "../../window/WindowLauncher"
import type { DesktopIpcHandlers } from "../DesktopIpc"

const IMPORT_FILTERS = [
  { name: "Ballest maps", extensions: MAP_EXTENSIONS.map((ext) => ext.slice(1)) },
  { name: "All files", extensions: ["*"] }
]

/** Shows a folder in the file manager; false when it isn't there yet. */
const reveal = Effect.fnUntraced(function*(folder: Option.Option<string>) {
  if (Option.isNone(folder)) return false
  return yield* (yield* ElectronShell).openFolder(folder.value)
})

export const projectHandlers = {
  projectState: Effect.fn("ipc.projectState")(function*() {
    return yield* (yield* Projects).state
  }),
  /** A folder dialog starting at the project in use; the page then says where the folder opens. */
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
    return yield* projects.pick(picked.value)
  }),
  checkProject: Effect.fn("ipc.checkProject")(function*(target) {
    yield* (yield* Projects).check(target)
  }),
  /** New window: this window keeps its project; the new copy takes `target` (a new project is made here first). */
  openProjectWindow: Effect.fn("ipc.openProjectWindow")(function*(target) {
    yield* (yield* WindowLauncher).open(yield* (yield* Projects).prepareWindow(target))
  }),
  switchProject: Effect.fn("ipc.switchProject")(function*({ path }) {
    return yield* (yield* Projects).switchTo(path)
  }),
  /** New project: `<projectsFolder>/<name>`, made and used. */
  createProject: Effect.fn("ipc.createProject")(function*({ name }) {
    return yield* (yield* Projects).createNew(name)
  }),
  revealProject: Effect.fn("ipc.revealProject")(function*({ which }) {
    return yield* reveal(yield* (yield* Projects).folderOf(which))
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
    return yield* (yield* MapFiles).list
  }),
  readMap: Effect.fn("ipc.readMap")(function*({ fileName }) {
    return yield* (yield* MapFiles).read(fileName)
  }),
  createMap: Effect.fn("ipc.createMap")(function*({ fileName, text }) {
    return yield* (yield* MapFiles).create(fileName, text)
  }),
  saveMap: Effect.fn("ipc.saveMap")(function*({ fileName, text }) {
    return yield* (yield* MapFiles).save(fileName, text)
  }),
  renameMap: Effect.fn("ipc.renameMap")(function*({ from, to, text }) {
    return yield* (yield* MapFiles).rename(from, to, text)
  }),
  writeSidecar: Effect.fn("ipc.writeSidecar")(function*({ fileName, text }) {
    yield* (yield* MapFiles).writeSidecar(fileName, text)
  }),
  listPrefabs: Effect.fn("ipc.listPrefabs")(function*({ tier }) {
    return yield* (yield* Prefabs).list(tier)
  }),
  readPrefab: Effect.fn("ipc.readPrefab")(function*(ref) {
    return yield* (yield* Prefabs).read(ref)
  }),
  writePrefab: Effect.fn("ipc.writePrefab")(function*(payload) {
    return yield* (yield* Prefabs).write(payload)
  }),
  deletePrefab: Effect.fn("ipc.deletePrefab")(function*(ref) {
    yield* (yield* Prefabs).remove(ref)
  }),
  renamePrefab: Effect.fn("ipc.renamePrefab")(function*(payload) {
    return yield* (yield* Prefabs).rename(payload)
  }),
  revealPrefabs: Effect.fn("ipc.revealPrefabs")(function*({ tier }) {
    return yield* reveal(yield* (yield* Prefabs).folderOf(tier))
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
    return yield* (yield* MapFiles).pick(picked.value)
  }),
  importMap: Effect.fn("ipc.importMap")(function*(payload) {
    return yield* (yield* MapFiles).importMap(payload)
  }),
  exportMap: Effect.fn("ipc.exportMap")(function*(payload) {
    return yield* (yield* MapExports).exportMap(payload)
  }),
  /** Sync detection: the exports the game changed since the last look, and the ones gone (docs/PROJECTS.md § Sync). */
  checkExports: Effect.fn("ipc.checkExports")(function*() {
    return yield* (yield* MapExports).checkExports
  }),
  reimportMap: Effect.fn("ipc.reimportMap")(function*({ fileName }) {
    return yield* (yield* MapExports).reimportMap(fileName)
  }),
  listBackups: Effect.fn("ipc.listBackups")(function*() {
    return yield* (yield* MapFiles).backups
  }),
  readBackup: Effect.fn("ipc.readBackup")(function*(ref) {
    return yield* (yield* MapFiles).readBackup(ref)
  })
} satisfies Partial<DesktopIpcHandlers>
