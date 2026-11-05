/**
 * Opening, importing and switching (docs/PROJECTS.md § Import): another of the project's maps, a map file from
 * anywhere, another project. Maps open in tabs of their own; what would replace a map's edits asks about them first.
 */
import { Effect, Option } from "effect"
import { setLevelNames } from "../../domain/edits"
import { copyNameOf, mapFileNameOf, mapLabelOf } from "../../domain/factory"
import { MapCodec } from "../../services/MapCodec"
import { MapExporter } from "../../services/MapExporter"
import { Platform, PlatformError, type ProjectState, type ProjectTarget } from "../../services/Platform"
import type { AppServices } from "../../services/runtime"
import { hasWindowToTakeOver, type ImportClash, isChooserRequired, useEditor } from "../store"
import { openProjectMapFile, openStartingMap } from "./maps"
import { run } from "./run"
import { fileOf, hasProject, projectName, refreshProject, revealIn, showMap } from "./shared"
import { unlessAnyCancelled, unlessCancelledFor } from "./unsaved"

/** Opens one of the project's maps (`openProjectMapFile`): its tab if it has one, else a new tab. */
export const openProjectMap = (fileName: string) =>
  run(openProjectMapFile(fileName).pipe(Effect.ensuring(Effect.ignore(refreshProject))))

/**
 * Rename…, Duplicate… or Recover previous version… for one of the project's maps from the Project panel or Project
 * settings: the dialogs act on the open map, so the map is opened first, then its dialog.
 */
export const nameProjectMap = (fileName: string, mode: "rename" | "duplicate" | "recover") =>
  withProjectMapOpen(fileName, Effect.sync(() => useEditor.getState().openDialog({ id: mode })))

/**
 * Runs `then` with the project map `fileName` open in the active tab (`openProjectMap` first when it isn't). The
 * Project panel's per-map actions go through this, since Export, Play and the name dialogs act on the open map.
 */
export const withProjectMapOpen = (fileName: string, then: Effect.Effect<void, unknown, AppServices>) =>
  run(
    Effect.gen(function*() {
      if (useEditor.getState().file?.name !== fileName) {
        yield* openProjectMapFile(fileName)
        if (useEditor.getState().file?.name !== fileName) return
      }
      yield* then
    })
  )

/**
 * Copies a picked file into the project (or reports the clash) and opens the copy in a new tab; `replace` writes over
 * the project's map of that name, which is shown in its own tab when one has it open (`open`).
 */
const importInto = Effect.fn("importInto")(function*(pending: ImportClash, replace: boolean, open = false) {
  const platform = yield* Platform
  const { source, fileName, text, map } = pending
  const result = yield* platform.importMap({ source, fileName, text, replace })
  if (result._tag === "Clash") {
    useEditor.getState().openDialog({ id: "importClash", ...pending })
    return
  }
  yield* showMap(map, fileOf(result.map), { into: open ? "active" : "newTab" })
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
    yield* showMap(map, { name, path: null }, { into: "newTab" })
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

export const importMap = () => run(importMapFile)

/**
 * The clash dialog's Replace: the project's map of that name goes to backups. When a tab has it open, that tab is asked
 * about its unsaved edits first and shows the import.
 */
export const replaceOnImportEffect = Effect.gen(function*() {
  const { dialog: importClash, closeDialog } = useEditor.getState()
  if (importClash?.id !== "importClash") return
  closeDialog()
  yield* unlessCancelledFor(importClash.fileName, "replaceOnImport", (open) => importInto(importClash, true, open))
})

export const replaceOnImport = () => run(replaceOnImportEffect)

/** The clash dialog's Import as copy: the imported map is renamed `<name> 2` (or the next free number). */
export const importAsCopyEffect = Effect.gen(function*() {
  const { dialog: importClash, closeDialog, projectMaps } = useEditor.getState()
  if (importClash?.id !== "importClash") return
  closeDialog()
  const { levelDisplayName, creatorName } = importClash.map.worldSettings.levelData
  const creator = creatorName.trim()
  const taken = new Set(projectMaps.map((m) => m.fileName))
  const name = copyNameOf(levelDisplayName.trim(), creator, taken)
  const prepared = yield* (yield* MapExporter).prepare(setLevelNames(importClash.map, name, creator))
  yield* importInto({ ...importClash, fileName: prepared.filename, text: prepared.text, map: prepared.map }, false)
})

export const importAsCopy = () => run(importAsCopyEffect)

/**
 * Uses another project from now on, asking about each tab's unsaved edits first (Save writes them into the project
 * being left). The open maps stay open; they belonged to the old project, so they are unsaved here. Untitled Project
 * asks nothing: no map is left behind, and Save there would name a project of its own beside the one being chosen. The
 * required chooser has only the blank map behind it, so a pick there is this window's start: it opens the project's map.
 */
const changeProject = (
  change: (platform: Platform["Service"]) => Effect.Effect<Option.Option<ProjectState>, PlatformError>
) => {
  const use = Effect.gen(function*() {
    const starting = isChooserRequired(useEditor.getState())
    const before = useEditor.getState().project?.current?.path ?? null
    const next = yield* change(yield* Platform)
    if (Option.isNone(next)) return
    const after = next.value.current
    if (after === null || after.path !== before) useEditor.getState().detachFiles()
    yield* refreshProject
    if (starting) yield* openStartingMap
    useEditor.getState().notify("info", `Using the project ${after?.name ?? "Untitled Project"}`, {
      kind: "projectChanged",
      actions: [revealIn("project")]
    })
  })
  return Effect.suspend(() => hasProject() ? unlessAnyCancelled("switchProject", use) : use)
}

/** New project… in this window: `<projectsFolder>/<name>` is made, once any unsaved edits are answered, and becomes the project. */
export const createProjectEffect = (name: string) =>
  changeProject((platform) => Effect.asSome(platform.createProject(name)))

const openHere = (target: ProjectTarget) =>
  target._tag === "New"
    ? createProjectEffect(target.name)
    : changeProject((platform) => Effect.asSome(platform.switchProject(target.path)))

/**
 * Opens a project the way an editor does: main refuses what it can't open (another window has it, the name is taken)
 * before anything is asked, then the whereToOpen dialog asks where it goes, unless this window has nothing to take
 * over. Nothing is written until that is answered.
 */
const openProjectEffect = (target: ProjectTarget, name: string) =>
  Effect.gen(function*() {
    yield* (yield* Platform).checkProject(target).pipe(Effect.tapError(() => Effect.ignore(refreshProject)))
    const state = useEditor.getState()
    if (hasWindowToTakeOver(state)) {
      state.openDialog({ id: "whereToOpen", target, name })
      return
    }
    state.closeDialog()
    yield* openHere(target)
  })

export const chooseProjectEffect = Effect.gen(function*() {
  const picked = yield* (yield* Platform).chooseProject
  if (Option.isNone(picked)) return
  const { name, path } = picked.value
  if (path === useEditor.getState().project?.current?.path) return
  yield* openProjectEffect({ _tag: "Existing", path }, name)
})

/** File › Open project…: a folder dialog, then where it opens (the game's maps folder is refused, with the reason). */
export const chooseProject = () => run(chooseProjectEffect)

export const switchProjectEffect = (path: string) =>
  Effect.suspend(() => {
    const { project } = useEditor.getState()
    if (path === project?.current?.path) return Effect.void
    return openProjectEffect({ _tag: "Existing", path }, project?.recent.find((p) => p.path === path)?.name ?? path)
  })

/** A recent project: where it opens, as with Open project…; the one in use already is left alone. */
export const switchProject = (path: string) => run(switchProjectEffect(path))

export const newProjectEffect = (name: string) => openProjectEffect({ _tag: "New", name }, name)

/** File › New project…, once it has a name: where it opens, and only then is the folder made. */
export const newProject = (name: string) => run(newProjectEffect(name))

/** The open whereToOpen dialog's project, once the dialog is closed; none when it isn't open. */
const takeWhereToOpen = () => {
  const { dialog, closeDialog } = useEditor.getState()
  if (dialog?.id !== "whereToOpen") return Option.none()
  closeDialog()
  return Option.some(dialog)
}

/** The whereToOpen dialog's This window: leaves this project, as switching always has. */
export const openInThisWindowEffect = Effect.suspend(() =>
  Option.match(takeWhereToOpen(), { onNone: () => Effect.void, onSome: ({ target }) => openHere(target) })
)

export const openInThisWindow = () => run(openInThisWindowEffect)

/** The whereToOpen dialog's New window: another running copy takes the project, and nothing changes here. */
export const openInNewWindowEffect = Effect.gen(function*() {
  const asked = takeWhereToOpen()
  if (Option.isNone(asked)) return
  const { name, target } = asked.value
  yield* (yield* Platform).openProjectWindow(target)
  useEditor.getState().notify("info", `Opening ${name} in a new window`, { kind: "projectWindowOpened" })
})

export const openInNewWindow = () => run(openInNewWindowEffect)
