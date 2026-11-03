/**
 * What the action modules share about the project, the open map and notices; internal to `editor/actions`, not
 * re-exported.
 */
import { Effect } from "effect"
import type { GameLinkNotice } from "../../domain/gameLink"
import { floorHeightOf } from "../../domain/level"
import type { MapFile } from "../../domain/MapFile"
import { type MapPrefs, mapPrefsKeyOf } from "../../domain/MapPrefs"
import { MapPrefsStore } from "../../services/MapPrefsStore"
import { type NotificationAction, Platform, type ProjectMap } from "../../services/Platform"
import { type OpenFile, useEditor } from "../store"

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

/** Puts a map into the editor, with the prefs saved for it; `dirty` opens it as unsaved edits of `file`. */
export const showMap = Effect.fn("showMap")(function*(
  map: MapFile,
  file: OpenFile | null,
  options?: { readonly dirty: boolean }
) {
  // unreadable prefs only cost the saved grid height and Export on save
  const prefs = yield* MapPrefsStore.use((store) => store.load(mapPrefsKeyOf(map))).pipe(
    Effect.orElseSucceed((): MapPrefs => ({}))
  )
  useEditor.getState().loadMap(map, file, prefs.gridHeight, {
    exportOnSave: prefs.exportOnSave === true,
    dirty: options?.dirty === true
  })
})

/**
 * The open map's prefs, under its current name: the grid height when it isn't the player
 * start's (what a load would pick anyway), and Export on save when it is on.
 */
export const saveMapPrefs = Effect.gen(function*() {
  const { doc, floorHeight, exportOnSave } = useEditor.getState()
  const prefs: MapPrefs = {
    ...(floorHeight !== floorHeightOf(doc.map) && { gridHeight: floorHeight }),
    ...(exportOnSave && { exportOnSave })
  }
  yield* MapPrefsStore.use((store) => store.save(mapPrefsKeyOf(doc.map), prefs))
})

/** Records a Game link notice (or one of Play's, which share its kinds) in the notification centre. */
export const notifyNotice = ({ level, title, kind, body, persistent, actions }: GameLinkNotice) =>
  useEditor.getState().notify(level, title, { kind, persistent, actions, ...(body !== undefined && { body }) })
