/**
 * Sync (docs/PROJECTS.md § Sync, docs/DESKTOP.md § Sync): maps changed in the in-game editor are found on launch, on
 * focus and when a Play's game session ends. Re-import takes the game's version into the project, by itself when the
 * project has nothing to lose, and the syncConflict dialog asks when it has.
 */
import { Deferred, Effect, Stream } from "effect"
import { mapLabelOf } from "../../domain/factory"
import { syncsFromGame } from "../../domain/linkState"
import { loadGameStructure } from "../../domain/sidecar"
import { Platform } from "../../services/Platform"
import { fileTabOf, tabWithFile, useEditor } from "../store"
import { writeToGame } from "./gameWrite"
import { checkPrefabs } from "./prefabs"
import { notifyFailure, run, runUntilCleanup } from "./run"
import { withSavedOpenMap } from "./save"
import { fileOf, loadProjectMapFile, refreshProject, showMap } from "./shared"
import { askSyncConflict, gameDiffOf, textKeepingPivots } from "./syncConflict"
import { unlessCancelledFor } from "./unsaved"

/** Tells that the game changed a map's export and the project's has moved on too, with the window that sorts it out. */
const notifyConflict = (fileName: string) =>
  useEditor.getState().notify("info", `${mapLabelOf(fileName)} was changed in the game`, {
    kind: "changedInGame",
    body: "Resolve shows how the two versions differ and asks which to keep.",
    actions: [
      { label: "Resolve", command: { _tag: "ResolveConflict", fileName } },
      { label: "Ignore", command: { _tag: "Dismiss" } }
    ]
  })

/**
 * What a change the game made to `fileName` calls for (docs/DESKTOP.md § Sync): with nothing to lose the game's version
 * comes across by itself; otherwise the conflict window asks, or a notification does while another dialog is up. A file
 * that doesn't read, as one the game is still writing, is left for the next look, which reports nothing, so it's told.
 */
const settleChange = Effect.fnUntraced(function*(fileName: string) {
  const state = useEditor.getState()
  const map = state.projectMaps.find((m) => m.fileName === fileName)
  if (map === undefined) return
  const diff = yield* gameDiffOf(fileName)
  if (diff !== null && syncsFromGame(map, diff, { unsaved: fileTabOf(state, fileName)?.dirty === true })) {
    return yield* reimportMapEffect(fileName)
  }
  if (diff === null || useEditor.getState().dialog !== null) notifyConflict(fileName)
  else {useEditor.getState().openDialog({
      id: "syncConflict",
      name: fileName,
      from: "check",
      replacePublished: false,
      diff
    })}
})

/**
 * One look at the exports (desktop): main hashes each linked map's export and reports what the game changed since the
 * last look, each change once; a map whose export is gone shows Not exported from then on. The maps are listed again,
 * so the status bar and the Project panel show the states. A failure is only logged: the next focus looks again.
 */
const checkExportsOnce = Effect.gen(function*() {
  const platform = yield* Platform
  if (!platform.capabilities.projects) return
  const { changed } = yield* platform.checkExports
  yield* refreshProject
  for (const fileName of changed) {
    yield* settleChange(fileName).pipe(Effect.catch(() => Effect.sync(() => notifyConflict(fileName))))
  }
}).pipe(Effect.catch((error) => Effect.logWarning("Couldn't check the maps exported to the game", error)))

/** The check running now, if any. */
let runningCheck: Deferred.Deferred<void> | null = null

/**
 * Sync detection, on launch, on window focus and when a Play's game session ends. A check asked for while one runs
 * joins it rather than looking again: the game closing usually brings both the focus and the end of the session.
 */
export const checkExportsEffect = Effect.suspend(() => {
  if (runningCheck !== null) return Deferred.await(runningCheck)
  const done = Deferred.makeUnsafe<void>()
  runningCheck = done
  return checkExportsOnce.pipe(
    Effect.ensuring(Effect.suspend(() => {
      runningCheck = null
      return Deferred.succeed(done, undefined)
    }))
  )
})

/** The window got the focus back: the user may have saved a map in the in-game editor meanwhile. */
export const checkExports = () => run(checkExportsEffect)

/**
 * Re-import: the game's version of a map replaces the project's (which goes to the project's backups), and the link
 * records it as in sync. Its sidecar is re-matched against it, as on any open. A tab that has the map open is made
 * active and reloaded from it, after asking about its unsaved edits.
 */
export const reimportMapEffect = (fileName: string) =>
  unlessCancelledFor(fileName, "reimport", (open) =>
    Effect.gen(function*() {
      const file = yield* (yield* Platform).reimportMap(fileName, yield* textKeepingPivots(fileName))
      yield* refreshProject
      const { loaded, map } = yield* loadProjectMapFile(file, loadGameStructure)
      if (open) yield* showMap(map, fileOf(file), { loaded })
      useEditor.getState().notify("info", `Re-imported ${mapLabelOf(fileName)} from the game`, {
        kind: "mapReimported",
        body: "The project's previous version is in the backups (the map's menu › Backups…).",
        actions: open ? [] : [{ label: "Open", command: { _tag: "OpenMap", fileName } }]
      })
    }))

export const reimportMap = (fileName: string) => run(reimportMapEffect(fileName))

/** Runs `next` on `name` with any unsaved edits in its tab saved first, so what replaces them leaves them in the backups. */
const withEditsSaved = <E, R>(name: string, next: (fileName: string) => Effect.Effect<void, E, R>) =>
  Effect.suspend(() => {
    const state = useEditor.getState()
    const tabId = tabWithFile(state, name)
    if (tabId === undefined || fileTabOf(state, name)?.dirty !== true) return next(name)
    state.activateTab(tabId)
    return withSavedOpenMap(next)
  })

/**
 * The syncConflict dialog's Keep project version: the export that found the conflict goes on over the game's copy, or
 * one is made for a conflict a look at the exports found. The game's version goes to the backups, as everything Export
 * writes over does.
 */
export const keepProjectVersionEffect = Effect.suspend(() => {
  const { dialog: conflict, closeDialog } = useEditor.getState()
  closeDialog()
  if (conflict?.id !== "syncConflict") return Effect.void
  const { from, name, replacePublished } = conflict
  return withEditsSaved(
    name,
    (fileName) =>
      writeToGame(from === "check" ? "export" : from, fileName, { replacePublished, overwriteChanged: true })
  )
})

export const keepProjectVersion = () => run(keepProjectVersionEffect)

/** The syncConflict dialog's Use game version: the game's version replaces the project's, which goes to the backups. */
export const takeGameVersionEffect = Effect.suspend(() => {
  const { dialog: conflict, closeDialog } = useEditor.getState()
  closeDialog()
  return conflict?.id === "syncConflict" ? withEditsSaved(conflict.name, reimportMapEffect) : Effect.void
})

export const takeGameVersion = () => run(takeGameVersionEffect)

/** Resolve on a notification or the status bar: the conflict window, about a map that is still changed in the game. */
export const resolveConflict = (fileName: string) => run(askSyncConflict(fileName, "check", false))

/**
 * A game session Play started or joined has ended: the game may have changed the export (the in-game editor saves
 * over it) or a prefab (`saveprefab`), so both are checked.
 */
const playSessionEnded = Effect.suspend(() => checkExportsEffect.pipe(Effect.andThen(checkPrefabs)))

/** Runs `playSessionEnded` at the end of each game session Play started, until interrupted. */
export const followPlaySessionsEffect = Effect.gen(function*() {
  yield* (yield* Platform).playSessionEnds.pipe(
    Stream.runForEach(() =>
      playSessionEnded.pipe(Effect.catchCause((cause) => Effect.sync(() => notifyFailure(cause))))
    )
  )
})

/** Follows the end of each game session Play started (`playSessionEnded`) until the returned function is called. */
export const followPlaySessions = () =>
  runUntilCleanup(followPlaySessionsEffect, "Stopped following the game sessions Play started")
