/**
 * What the action modules share about the project, the open map and notices; internal to `editor/actions`, not
 * re-exported.
 */
import type { ProjectMapFile } from "@ballest/contracts"
import { Effect } from "effect"
import { mapLabelOf } from "../../domain/factory"
import type { GameLinkNotice } from "../../domain/gameLink"
import { floorHeightOf } from "../../domain/level"
import type { MapVersion } from "../../domain/mapDiff"
import type { MapFile } from "../../domain/MapFile"
import { type MapPrefs, mapPrefsKeyOf } from "../../domain/MapPrefs"
import { type LoadedStructure, loadStructure, sidecarOf } from "../../domain/sidecar"
import { isDefaultViewLayout } from "../../domain/viewLayout"
import { MapCodec } from "../../services/MapCodec"
import { MapPrefsStore } from "../../services/MapPrefsStore"
import { type NotificationAction, Platform, type ProjectMap } from "../../services/Platform"
import {
  type Doc,
  fileTabOf,
  isBackupTab,
  type OpenFile,
  tabStateOf,
  type TabTarget,
  tabWithFile,
  useEditor
} from "../store"
import { followDefinitionsIn } from "./prefabFollow"

/** The project in use, the recent ones and its maps into the store (desktop). */
export const refreshProject = Effect.gen(function*() {
  const platform = yield* Platform
  if (!platform.capabilities.projects) return
  useEditor.getState().setProject(yield* platform.projectState, yield* platform.listMaps)
})

export const fileOf = (map: ProjectMap): OpenFile => ({ name: map.fileName, path: map.path })

/** A notification's Reveal: the project's maps folder, or the game's. */
export const revealIn = (where: "project" | "game"): NotificationAction => ({
  label: "Reveal in folder",
  command: where === "project" ? { _tag: "RevealProject" } : { _tag: "RevealGamePath", which: "mapsFolder" }
})

/** The project's name; Untitled Project while there is none (docs/DESKTOP.md § Projects and maps). */
export const projectName = () => useEditor.getState().project?.current?.name ?? "Untitled Project"

/** Whether there is a project to write maps into (desktop with one named; a browser has none and keeps maps in memory). */
export const hasProject = () => useEditor.getState().project?.current != null

/**
 * Writes the sidecar of `doc` for the project map `fileName` of hash `mapHash`, after the map (docs/PROJECTS.md § The
 * files). A browser has no project, and keeps it in the tab.
 */
export const writeSidecarOf = Effect.fn("writeSidecarOf")(function*(doc: Doc, fileName: string, mapHash: string) {
  const text = yield* MapCodec.use((codec) => codec.encodeSidecar(sidecarOf(doc.map, doc.ids, doc.structure, mapHash)))
  yield* (yield* Platform).writeSidecar({ fileName, text })
})

/** A map file with what the desktop keeps beside it. */
type MapFileRead = Pick<ProjectMapFile, "fileName" | "text" | "hash" | "sidecar">

/**
 * Decodes a map and its sidecar and puts them together (`loadStructure`), reporting the entries that matched nothing: a
 * `.balledit` changed behind the editor's back. A sidecar that won't decode leaves the map on its own, and says so: the
 * next Save replaces it, and it goes to backups.
 */
export const loadMapFile = Effect.fn("loadMapFile")(function*({ fileName, hash, sidecar, text }: MapFileRead) {
  const codec = yield* MapCodec
  const map = yield* codec.decode(text)
  const decoded = sidecar === null
    ? null
    : yield* codec.decodeSidecar(sidecar).pipe(
      Effect.catchTag(
        "SidecarDecodeError",
        Effect.fnUntraced(function*(error) {
          yield* Effect.logWarning(`Ignoring the sidecar of ${fileName}`, error.message)
          useEditor.getState().notify("error", `${mapLabelOf(fileName)}: its editor data couldn't be read`, {
            kind: "sidecarUnreadable",
            body:
              "It opened without its names, tags and nested groups. The next Save replaces that file; the old one goes to the backups."
          })
          return null
        })
      )
    )
  const loaded = loadStructure(map, hash, decoded)
  const { unmatched } = loaded
  if (unmatched > 0) {
    useEditor.getState().notify(
      "info",
      `${mapLabelOf(fileName)}: ${unmatched} ${unmatched === 1 ? "piece" : "pieces"} lost their editor data`,
      {
        kind: "sidecarUnmatched",
        body:
          "The map changed outside the editor and these pieces can't be found in it any more, so their names, tags and places in groups are gone."
      }
    )
  }
  return { map, loaded }
})

/**
 * A project map, read and put together with its sidecar. A sidecar that was re-matched is written back at once, so what
 * it lost is reported this once and the next open trusts it again.
 */
export const loadProjectMapFile = Effect.fn("loadProjectMapFile")(function*(file: MapFileRead) {
  const opened = yield* loadMapFile(file)
  if (opened.loaded.rematched) {
    const { ids, structure } = opened.loaded
    // the map still opens; the next open matches it again, and the next Save writes it
    yield* writeSidecarOf({ map: opened.map, ids, structure }, file.fileName, file.hash).pipe(
      Effect.catch((error) => Effect.logWarning(`Couldn't write the sidecar of ${file.fileName}`, error))
    )
  }
  return opened
})

/** The prefs kept for `map`; unreadable ones only cost the saved grid height, Export on save and view layout. */
export const prefsOf = (map: MapFile) =>
  Effect.flatMap(Effect.service(MapPrefsStore), (store) => store.load(mapPrefsKeyOf(map))).pipe(
    Effect.orElseSucceed((): MapPrefs => ({}))
  )

/**
 * Puts a map into the editor, with the prefs saved for it, in the tab `into` says (the active one by default); `dirty`
 * opens it as unsaved edits of `file`, and `backup` marks it as a restored backup. `loaded` is what its sidecar gave.
 */
export const showMap = Effect.fn("showMap")(function*(
  map: MapFile,
  file: OpenFile | null,
  options?: {
    readonly dirty?: boolean
    readonly backup?: boolean
    readonly into?: TabTarget
    readonly loaded?: LoadedStructure
  }
) {
  const prefs = yield* prefsOf(map)
  useEditor.getState().loadMap(map, file, prefs.gridHeight, {
    exportOnSave: prefs.exportOnSave === true,
    viewLayout: prefs.viewLayout,
    dirty: options?.dirty === true,
    backup: options?.backup === true,
    into: options?.into,
    loaded: options?.loaded
  })
  const state = useEditor.getState()
  // a background tab is the one just added, which has the file
  const tabId = options?.into === "backgroundTab" && file !== null ? tabWithFile(state, file.name) : state.tabId
  if (tabId !== undefined) yield* followDefinitionsIn(tabId)
})

/**
 * A tab's map prefs (the active tab's by default), under its current name: the grid height when it isn't the player
 * start's (what a load would pick anyway), Export on save when it is on, and the view layout when it isn't the default.
 */
export const saveTabPrefs = Effect.fn("saveTabPrefs")(function*(tabId?: string) {
  const s = useEditor.getState()
  const tab = tabStateOf(s, tabId ?? s.tabId)
  // a restored backup goes by the name of the map it came from, whose prefs these would write over
  if (tab === undefined || isBackupTab(tab)) return
  const { doc, floorHeight, exportOnSave, viewLayout } = tab
  const prefs: MapPrefs = {
    ...(floorHeight !== floorHeightOf(doc.map) && { gridHeight: floorHeight }),
    ...(exportOnSave && { exportOnSave }),
    ...(!isDefaultViewLayout(viewLayout) && { viewLayout })
  }
  yield* MapPrefsStore.use((store) => store.save(mapPrefsKeyOf(doc.map), prefs))
})

/** Writes `text` over the project map `fileName`, or moves it to `to` when the map's name changed. */
export const writeProjectMap = Effect.fn("writeProjectMap")(function*(fileName: string, to: string, text: string) {
  const platform = yield* Platform
  return yield* to === fileName
    ? platform.saveMap({ fileName, text })
    : platform.renameMap({ from: fileName, to, text })
})

/** Records a Game link notice (or one of Play's, which share its kinds) in the notification centre. */
export const notifyNotice = ({ level, title, kind, body, persistent, actions }: GameLinkNotice) =>
  useEditor.getState().notify(level, title, { kind, persistent, actions, ...(body !== undefined && { body }) })

/** A file's map and each item's key, saying nothing about a sidecar that doesn't fit: the preview only looks. */
export const versionOfFile = Effect.fnUntraced(function*(file: Pick<ProjectMapFile, "text" | "hash" | "sidecar">) {
  const codec = yield* MapCodec
  const map = yield* codec.decode(file.text)
  const sidecar = file.sidecar === null
    ? null
    : yield* codec.decodeSidecar(file.sidecar).pipe(Effect.orElseSucceed(() => null))
  const { ids } = loadStructure(map, file.hash, sidecar)
  return { map, ids } satisfies MapVersion
})

/**
 * The map `fileName` as it is now: in its tab with any unsaved edits, else its project file. Null when the project has
 * no such map any more, or its file can't be read.
 */
export const currentVersionOf = Effect.fnUntraced(function*(fileName: string) {
  const tab = fileTabOf(useEditor.getState(), fileName)
  if (tab !== undefined) return tab.doc satisfies MapVersion
  return yield* (yield* Platform).readMap(fileName).pipe(
    Effect.flatMap(versionOfFile),
    Effect.orElseSucceed(() => null)
  )
})
