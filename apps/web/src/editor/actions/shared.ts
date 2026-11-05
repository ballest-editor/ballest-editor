/**
 * What the action modules share about the project, the open map and notices; internal to `editor/actions`, not
 * re-exported.
 */
import { Effect } from "effect"
import { mapLabelOf } from "../../domain/factory"
import type { GameLinkNotice } from "../../domain/gameLink"
import { floorHeightOf } from "../../domain/level"
import type { MapFile } from "../../domain/MapFile"
import { type MapPrefs, mapPrefsKeyOf } from "../../domain/MapPrefs"
import { type LoadedStructure, loadStructure, sidecarOf } from "../../domain/sidecar"
import { MapCodec } from "../../services/MapCodec"
import { MapPrefsStore } from "../../services/MapPrefsStore"
import { type NotificationAction, Platform, type ProjectMap } from "../../services/Platform"
import { type Doc, type OpenFile, tabStateOf, type TabTarget, useEditor } from "../store"

/** The project in use, the recent ones and its maps into the store (desktop). */
export const refreshProject = Effect.gen(function*() {
  const platform = yield* Platform
  if (!platform.capabilities.projects) return
  useEditor.getState().setProject(yield* platform.projectState, yield* platform.listMaps)
})

export const fileOf = (map: ProjectMap): OpenFile => ({ name: map.fileName, path: map.path })

/** A notification's Reveal: the project's maps folder, or the game's. */
export const revealIn = (where: "project" | "game"): NotificationAction => ({
  label: "Reveal",
  command: where === "project" ? { _tag: "RevealProject" } : { _tag: "RevealGamePath", which: "mapsFolder" }
})

/** The project's name; Untitled Project while there is none (docs/PROJECTS.md § Shell). */
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
interface MapFileRead {
  readonly fileName: string
  readonly text: string
  readonly hash: string
  readonly sidecar: string | null
}

/** A map and what its sidecar adds to it. */
export interface LoadedMap {
  readonly map: MapFile
  readonly loaded: LoadedStructure
}

/** Tells that a sidecar lost entries to a `.balledit` changed behind the editor's back. */
const notifyUnmatched = (fileName: string, unmatched: number) =>
  useEditor.getState().notify(
    "info",
    `${mapLabelOf(fileName)}: ${unmatched} ${unmatched === 1 ? "piece" : "pieces"} lost their editor data`,
    {
      kind: "sidecarUnmatched",
      body:
        "The map changed outside the editor and these pieces can't be found in it any more, so their names, tags and places in groups are gone."
    }
  )

/**
 * Decodes a map and its sidecar and puts them together (`loadStructure`), reporting the entries that matched nothing. A
 * sidecar that won't decode leaves the map on its own, and says so: the next Save replaces it, and it goes to backups.
 */
export const loadMapFile = Effect.fn("loadMapFile")(function*({ fileName, hash, sidecar, text }: MapFileRead) {
  const codec = yield* MapCodec
  const map = yield* codec.decode(text)
  const decoded = sidecar === null
    ? null
    : yield* codec.decodeSidecar(sidecar).pipe(
      Effect.catchTag(
        "SidecarDecodeError",
        (error) =>
          Effect.logWarning(`Ignoring the sidecar of ${fileName}`, error.message).pipe(
            Effect.andThen(Effect.sync(() =>
              useEditor.getState().notify("error", `${mapLabelOf(fileName)}: its editor data couldn't be read`, {
                kind: "sidecarUnreadable",
                body:
                  "It opened without its names, tags and nested groups. The next Save replaces that file; the old one goes to the backups."
              })
            )),
            Effect.as(null)
          )
      )
    )
  const loaded = loadStructure(map, hash, decoded)
  if (loaded.unmatched > 0) notifyUnmatched(fileName, loaded.unmatched)
  return { map, loaded } satisfies LoadedMap
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

/**
 * Puts a map into the editor, with the prefs saved for it, in the tab `into` says (the active one by default); `dirty`
 * opens it as unsaved edits of `file`. `loaded` is what its sidecar gave.
 */
export const showMap = Effect.fn("showMap")(function*(
  map: MapFile,
  file: OpenFile | null,
  options?: { readonly dirty?: boolean; readonly into?: TabTarget; readonly loaded?: LoadedStructure }
) {
  // unreadable prefs only cost the saved grid height and Export on save
  const prefs = yield* MapPrefsStore.use((store) => store.load(mapPrefsKeyOf(map))).pipe(
    Effect.orElseSucceed((): MapPrefs => ({}))
  )
  useEditor.getState().loadMap(map, file, prefs.gridHeight, {
    exportOnSave: prefs.exportOnSave === true,
    dirty: options?.dirty === true,
    ...(options?.into !== undefined && { into: options.into }),
    ...(options?.loaded !== undefined && { loaded: options.loaded })
  })
})

/**
 * A tab's map prefs (the active tab's by default), under its current name: the grid height when it isn't the player
 * start's (what a load would pick anyway), and Export on save when it is on.
 */
export const saveTabPrefs = Effect.fn("saveTabPrefs")(function*(tabId?: string) {
  const s = useEditor.getState()
  const tab = tabStateOf(s, tabId ?? s.tabId)
  if (tab === undefined) return
  const { doc, floorHeight, exportOnSave } = tab
  const prefs: MapPrefs = {
    ...(floorHeight !== floorHeightOf(doc.map) && { gridHeight: floorHeight }),
    ...(exportOnSave && { exportOnSave })
  }
  yield* MapPrefsStore.use((store) => store.save(mapPrefsKeyOf(doc.map), prefs))
})

/** Records a Game link notice (or one of Play's, which share its kinds) in the notification centre. */
export const notifyNotice = ({ level, title, kind, body, persistent, actions }: GameLinkNotice) =>
  useEditor.getState().notify(level, title, { kind, persistent, actions, ...(body !== undefined && { body }) })
