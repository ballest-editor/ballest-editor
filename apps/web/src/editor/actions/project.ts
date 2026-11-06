/**
 * Opening, importing and switching (docs/PROJECTS.md § Import): another of the project's maps, a map file from
 * anywhere, another project. Maps open in tabs of their own; what would replace a map's edits asks about them first.
 */
import type { CreateProjectPayload } from "@ballest/contracts"
import { Effect, Option } from "effect"
import { setLevelNames } from "../../domain/edits"
import { copyNameOf, mapFileNameOf, mapLabelOf } from "../../domain/factory"
import { MapCodec } from "../../services/MapCodec"
import { MapExporter } from "../../services/MapExporter"
import { Platform, PlatformError, type ProjectState, type ProjectTarget } from "../../services/Platform"
import type { AppServices } from "../../services/runtime"
import { blankTabs, dirtyTabs, type ImportClash, isChooserRequired, useEditor } from "../store"
import { openProjectMapFile, openStartingMap, readProjectMapIntoEditor } from "./maps"
import { checkPrefabs } from "./prefabs"
import { run } from "./run"
import { hasProject, projectName, refreshProject, revealIn, showMap } from "./shared"
import { unlessAnyCancelled, unlessCancelledFor } from "./unsaved"

/** Opens one of the project's maps (`openProjectMapFile`): its tab if it has one, else a new tab. */
export const openProjectMap = (fileName: string) =>
  run(openProjectMapFile(fileName).pipe(Effect.ensuring(Effect.ignore(refreshProject))))

/**
 * Rename…, Duplicate… or Backups… for one of the project's maps from the Project panel: the dialogs act on the open
 * map, so the map is opened first, then its dialog.
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
  // from the project, which keeps what a map imported from the project itself has in its sidecar
  yield* readProjectMapIntoEditor(result.map.fileName, open ? "active" : "newTab")
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
 * After a switch of projects, blank tabs have nothing to carry over: they go, without a word. With nothing else open the
 * window starts on the project the way a launch does, in the blank tab's place, which is also how a pick in the required
 * chooser ends.
 */
const dropBlankTabs = Effect.gen(function*() {
  const s = useEditor.getState()
  const blank = blankTabs(s)
  const onlyBlank = blank.length === s.tabIds.length
  for (const id of blank) if (!onlyBlank || id !== s.tabId) s.closeTab(id)
  if (onlyBlank) yield* openStartingMap
})

/**
 * Uses another project from now on, asking what docs/DESKTOP.md § Window says. The open maps stay open, and those that
 * belonged to the old project are unsaved here.
 */
const changeProject = (change: (platform: Platform["Service"]) => Effect.Effect<ProjectState, PlatformError>) => {
  const use = Effect.gen(function*() {
    const before = useEditor.getState().project?.current?.path ?? null
    const { current: after } = yield* change(yield* Platform)
    if (after === null || after.path !== before) useEditor.getState().detachFiles()
    yield* refreshProject
    yield* checkPrefabs
    yield* dropBlankTabs
    useEditor.getState().notify("info", `Using the project ${after?.name ?? "Untitled Project"}`, {
      kind: "projectChanged",
      actions: [revealIn("project")]
    })
  })
  return Effect.suspend(() => hasProject() ? unlessAnyCancelled("switchProject", use) : use)
}

/** New project… in this window: its folder is made, once any unsaved edits are answered, and becomes the project. */
export const createProjectEffect = (project: CreateProjectPayload) =>
  changeProject((platform) => platform.createProject(project))

const openHere = (target: ProjectTarget) =>
  target._tag === "New"
    ? createProjectEffect(target)
    : changeProject((platform) => platform.switchProject(target.path))

/** Another running copy takes the project, and nothing changes here. */
const openInWindow = Effect.fnUntraced(function*(target: ProjectTarget, name: string) {
  yield* (yield* Platform).openProjectWindow(target)
  useEditor.getState().notify("info", `Opening ${name} in a new window`, { kind: "projectWindowOpened" })
})

/**
 * Opens a project the way an editor does: main refuses what it can't open (another window has it, the name is taken)
 * before anything is asked, then it opens in this window. The whereToOpen dialog asks first only while this window has
 * unsaved changes, and an Always do this has answered that already. The required chooser never asks, its pick being
 * this window's start. Nothing is written until that is settled.
 */
const openProjectEffect = Effect.fn("openProjectEffect")(function*(target: ProjectTarget, name: string) {
  yield* (yield* Platform).checkProject(target).pipe(Effect.tapError(() => Effect.ignore(refreshProject)))
  const state = useEditor.getState()
  const opensIn = isChooserRequired(state) ? "thisWindow" : state.settings.general.projectOpensIn
  if (opensIn === "ask" && dirtyTabs(state).length > 0) {
    state.openDialog({ id: "whereToOpen", target, name })
    return
  }
  state.closeDialog()
  yield* opensIn === "newWindow" ? openInWindow(target, name) : openHere(target)
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

/** `folder` is one picked in a dialog (`pickProjectFolder`); without it, `<projectsFolder>/<name>`. */
export const newProjectEffect = (name: string, folder?: string) =>
  openProjectEffect({ _tag: "New", name, ...(folder !== undefined && { folder }) }, name)

/** File › New project…, once it has a name: where it opens, as with Open project…, and only then is the folder made. */
export const newProject = (name: string, folder?: string) => run(newProjectEffect(name, folder))

/** Open in new window for a recent project: whatever Settings says, and refused as any opening is. */
export const openRecentInNewWindowEffect = ({ name, path }: { readonly name: string; readonly path: string }) =>
  Effect.gen(function*() {
    const target: ProjectTarget = { _tag: "Existing", path }
    yield* (yield* Platform).checkProject(target).pipe(Effect.tapError(() => Effect.ignore(refreshProject)))
    yield* openInWindow(target, name)
  })

export const openRecentInNewWindow = (project: { readonly name: string; readonly path: string }) =>
  run(openRecentInNewWindowEffect(project))

/** Reveal for a recent project, which needn't be the one in use. */
export const revealRecentProject = (path: string) =>
  run(Effect.flatMap(Effect.service(Platform), (platform) => platform.revealRecentProject(path)))

export const forgetRecentProjectEffect = (path: string) =>
  Effect.flatMap(Effect.service(Platform), (platform) => platform.forgetRecentProject(path)).pipe(
    Effect.andThen(refreshProject)
  )

/** Remove from recent: only the list changes, and the project's folder stays. */
export const forgetRecentProject = (path: string) => run(forgetRecentProjectEffect(path))

/** An answer to the whereToOpen dialog: it closes, and `open` goes on with its project. Nothing when it isn't open. */
const answerWhereToOpen = <E, R>(open: (target: ProjectTarget, name: string) => Effect.Effect<void, E, R>) =>
  Effect.suspend(() => {
    const { dialog, closeDialog } = useEditor.getState()
    if (dialog?.id !== "whereToOpen") return Effect.void
    closeDialog()
    return open(dialog.target, dialog.name)
  })

export const openInThisWindowEffect = answerWhereToOpen(openHere)

export const openInThisWindow = () => run(openInThisWindowEffect)

export const openInNewWindowEffect = answerWhereToOpen(openInWindow)

export const openInNewWindow = () => run(openInNewWindowEffect)
