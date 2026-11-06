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
  projectState: () => Effect.flatMap(Effect.service(Projects), (projects) => projects.state),
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
  checkProject: (target) => Effect.flatMap(Effect.service(Projects), (projects) => projects.check(target)),
  /** New window: this window keeps its project; the new copy takes `target` (a new project is made here first). */
  openProjectWindow: Effect.fn("ipc.openProjectWindow")(function*(target) {
    yield* (yield* WindowLauncher).open(yield* (yield* Projects).prepareWindow(target))
  }),
  switchProject: ({ path }) => Effect.flatMap(Effect.service(Projects), (projects) => projects.switchTo(path)),
  createProject: (project) => Effect.flatMap(Effect.service(Projects), (projects) => projects.createNew(project)),
  revealProject: ({ which }) =>
    Effect.flatMap(Effect.service(Projects), (projects) => projects.folderOf(which)).pipe(Effect.flatMap(reveal)),
  /** The start screen's and Recent projects' Reveal: the project needn't be the one in use. */
  revealRecentProject: ({ path }) =>
    Effect.flatMap(Effect.service(Projects), (projects) => projects.knownFolder(path)).pipe(Effect.flatMap(reveal)),
  forgetRecentProject: ({ path }) => Effect.flatMap(Effect.service(Projects), (projects) => projects.forget(path)),
  /** Project settings › General: the project's name. */
  renameProject: ({ name }) => Effect.flatMap(Effect.service(Projects), (projects) => projects.setName(name)),
  /** Keeps which map is open in the project, so the next launch opens it again. */
  rememberOpenMap: ({ fileName }) =>
    Effect.flatMap(Effect.service(Projects), (projects) => projects.rememberOpenMap(fileName)),
  listMaps: () => Effect.flatMap(Effect.service(MapFiles), (files) => files.list),
  readMap: ({ fileName }) => Effect.flatMap(Effect.service(MapFiles), (files) => files.read(fileName)),
  createMap: ({ fileName, text }) => Effect.flatMap(Effect.service(MapFiles), (files) => files.create(fileName, text)),
  saveMap: ({ fileName, text }) => Effect.flatMap(Effect.service(MapFiles), (files) => files.save(fileName, text)),
  renameMap: ({ from, to, text }) => Effect.flatMap(Effect.service(MapFiles), (files) => files.rename(from, to, text)),
  writeSidecar: ({ fileName, text }) =>
    Effect.flatMap(Effect.service(MapFiles), (files) => files.writeSidecar(fileName, text)),
  readMapThumbnail: ({ hash }) => Effect.flatMap(Effect.service(MapFiles), (files) => files.readThumbnail(hash)),
  writeMapThumbnail: (thumbnail) =>
    Effect.flatMap(Effect.service(MapFiles), (files) => files.writeThumbnail(thumbnail)),
  listPrefabs: ({ tier }) => Effect.flatMap(Effect.service(Prefabs), (prefabs) => prefabs.list(tier)),
  readPrefab: (ref) => Effect.flatMap(Effect.service(Prefabs), (prefabs) => prefabs.read(ref)),
  writePrefab: (payload) => Effect.flatMap(Effect.service(Prefabs), (prefabs) => prefabs.write(payload)),
  deletePrefab: (ref) => Effect.flatMap(Effect.service(Prefabs), (prefabs) => prefabs.remove(ref)),
  renamePrefab: (payload) => Effect.flatMap(Effect.service(Prefabs), (prefabs) => prefabs.rename(payload)),
  revealPrefabs: ({ tier }) =>
    Effect.flatMap(Effect.service(Prefabs), (prefabs) => prefabs.folderOf(tier)).pipe(Effect.flatMap(reveal)),
  listPrefabBackups: () => Effect.flatMap(Effect.service(Prefabs), (prefabs) => prefabs.backups),
  describePrefabBackup: (ref) => Effect.flatMap(Effect.service(Prefabs), (prefabs) => prefabs.describeBackup(ref)),
  restorePrefabBackup: (ref) => Effect.flatMap(Effect.service(Prefabs), (prefabs) => prefabs.restoreBackup(ref)),
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
  importMap: (payload) => Effect.flatMap(Effect.service(MapFiles), (files) => files.importMap(payload)),
  exportMap: (payload) => Effect.flatMap(Effect.service(MapExports), (exports) => exports.exportMap(payload)),
  /** Sync detection: the exports the game changed since the last look, and the ones gone (docs/PROJECTS.md § Sync). */
  checkExports: () => Effect.flatMap(Effect.service(MapExports), (exports) => exports.checkExports),
  reimportMap: ({ fileName }) => Effect.flatMap(Effect.service(MapExports), (exports) => exports.reimportMap(fileName)),
  listBackups: () => Effect.flatMap(Effect.service(MapFiles), (files) => files.backups),
  readBackup: (ref) => Effect.flatMap(Effect.service(MapFiles), (files) => files.readBackup(ref))
} satisfies Partial<DesktopIpcHandlers>
