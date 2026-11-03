/**
 * Opening, importing and switching (docs/PROJECTS.md § Import): another of the project's maps, a map file from
 * anywhere, another project. Each asks about the open map's unsaved edits first.
 */
import { Effect, Option } from "effect"
import { setLevelNames } from "../../domain/edits"
import { copyNameOf, mapFileNameOf, mapLabelOf } from "../../domain/factory"
import { MapCodec } from "../../services/MapCodec"
import { MapExporter } from "../../services/MapExporter"
import { Platform, PlatformError, type ProjectState } from "../../services/Platform"
import type { AppServices } from "../../services/runtime"
import { type ImportClash, useEditor } from "../store"
import { openProjectMapFile } from "./maps"
import { run } from "./run"
import { fileOf, hasProject, projectName, refreshProject, revealIn, showMap } from "./shared"
import { unlessCancelled } from "./unsaved"

/**
 * Opens one of the project's maps in the map tab (there is one), asking about the open map's unsaved edits first;
 * the open map itself is left alone.
 */
export const openProjectMap = (fileName: string) =>
  useEditor.getState().file?.name === fileName
    ? Promise.resolve(undefined)
    : run(
      unlessCancelled("openMap", openProjectMapFile(fileName)).pipe(Effect.ensuring(Effect.ignore(refreshProject)))
    )

/**
 * Rename… or Duplicate… for one of the project's maps from the Maps dialog or Project settings: the dialogs name the
 * open map, so the map is opened first (asking about the open map's unsaved edits), then its dialog.
 */
export const nameProjectMap = (fileName: string, mode: "rename" | "duplicate" | "recover") =>
  withProjectMapOpen(fileName, Effect.sync(() => useEditor.getState().openDialog(mode)))

/**
 * Runs `then` with the project map `fileName` open: it is opened first when another is (asking about that one's
 * unsaved edits; a cancel runs nothing). The Project panel's per-map actions go through this, since Export, Play and
 * the name dialogs act on the open map.
 */
export const withProjectMapOpen = (fileName: string, then: Effect.Effect<void, unknown, AppServices>) =>
  run(
    Effect.gen(function*() {
      if (useEditor.getState().file?.name !== fileName) {
        yield* unlessCancelled("openMap", openProjectMapFile(fileName))
        if (useEditor.getState().file?.name !== fileName) return
      }
      yield* then
    })
  )

/** Copies a picked file into the project (or reports the clash) and opens the copy. */
const importInto = Effect.fn("importInto")(function*(pending: ImportClash, replace: boolean) {
  const platform = yield* Platform
  const { source, fileName, text, map } = pending
  const result = yield* platform.importMap({ source, fileName, text, replace })
  if (result._tag === "Clash") {
    useEditor.getState().setImportClash(pending)
    return
  }
  yield* showMap(map, fileOf(result.map))
  yield* refreshProject
  useEditor.getState().notify(
    "info",
    `Imported ${mapLabelOf(fileName)} into ${projectName()} (${map.items.length} items)`,
    { kind: "mapImported", actions: [revealIn("project")] }
  )
})

/**
 * Open… in a browser: the file input, then the map in memory. Import… on desktop: a map file from anywhere is copied
 * into the project under the game's file name for it and opened from there; nothing outside the project is edited in
 * place. A `.balledit` is copied byte for byte; a `.ballmap` (a Workshop map) is written as the `.balledit` the game
 * would make of it.
 */
export const importMapFile = Effect.gen(function*() {
  const platform = yield* Platform
  if (platform.capabilities.projects && !hasProject()) {
    return yield* new PlatformError({
      message: "There is no project to import into yet. Save the open map to name one, or open a project."
    })
  }
  const picked = yield* platform.pickMapFile
  if (Option.isNone(picked)) return
  const { name, path, text } = picked.value
  const map = yield* MapCodec.use((codec) => codec.decode(text))
  if (Option.isNone(path)) {
    yield* showMap(map, { name, path: null })
    useEditor.getState().notify("info", `Opened ${name} (${map.items.length} items)`, { kind: "mapOpened" })
    return
  }
  const { levelDisplayName, creatorName } = map.worldSettings.levelData
  const pending = name.toLowerCase().endsWith(".balledit")
    ? { fileName: mapFileNameOf(levelDisplayName.trim(), creatorName.trim()), text, map }
    : yield* (yield* MapExporter).prepare(map).pipe(
      Effect.map((prepared) => ({ fileName: prepared.filename, text: prepared.text, map: prepared.map }))
    )
  yield* importInto({ source: path.value, ...pending }, false)
})

export const importMap = () => run(unlessCancelled("openMap", importMapFile))

/** The clash dialog's Replace: the project's map of that name goes to backups. */
export const replaceOnImportEffect = Effect.gen(function*() {
  const { importClash, setImportClash } = useEditor.getState()
  if (importClash === null) return
  setImportClash(null)
  yield* importInto(importClash, true)
})

export const replaceOnImport = () => run(replaceOnImportEffect)

/** The clash dialog's Import as copy: the imported map is renamed `<name> 2` (or the next free number). */
export const importAsCopyEffect = Effect.gen(function*() {
  const { importClash, setImportClash, projectMaps } = useEditor.getState()
  if (importClash === null) return
  setImportClash(null)
  const { levelDisplayName, creatorName } = importClash.map.worldSettings.levelData
  const creator = creatorName.trim()
  const taken = new Set(projectMaps.map((m) => m.fileName))
  const name = copyNameOf(levelDisplayName.trim(), creator, taken)
  const prepared = yield* (yield* MapExporter).prepare(setLevelNames(importClash.map, name, creator))
  yield* importInto({ ...importClash, fileName: prepared.filename, text: prepared.text, map: prepared.map }, false)
})

export const importAsCopy = () => run(importAsCopyEffect)

/**
 * Uses another project from now on, asking about unsaved edits first (Save writes them into the project being left).
 * The open map stays open; it belonged to the old project, so it is unsaved here.
 */
const changeProject = (
  change: (platform: Platform["Service"]) => Effect.Effect<Option.Option<ProjectState>, PlatformError>
) =>
  run(unlessCancelled(
    "switchProject",
    Effect.gen(function*() {
      const before = useEditor.getState().project?.current?.path ?? null
      const next = yield* change(yield* Platform)
      if (Option.isNone(next)) return
      const after = next.value.current
      if (after === null || after.path !== before) useEditor.getState().detachFile()
      yield* refreshProject
      useEditor.getState().notify("info", `Using the project ${after?.name ?? "Untitled Project"}`, {
        kind: "projectChanged",
        actions: [revealIn("project")]
      })
    })
  ))

/** A folder dialog; the chosen folder becomes the project (the game's maps folder is refused, with the reason). */
export const chooseProject = () => changeProject((platform) => platform.chooseProject)

/** Goes back to a recent project; the one in use already is left alone. */
export const switchProject = (path: string) =>
  path === useEditor.getState().project?.current?.path
    ? Promise.resolve(undefined)
    : changeProject((platform) => Effect.asSome(platform.switchProject(path)))

/** New project…: `<projectsFolder>/<name>` is made and becomes the project. */
export const createProject = (name: string) => changeProject((platform) => Effect.asSome(platform.createProject(name)))
