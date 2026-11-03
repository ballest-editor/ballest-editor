/**
 * Sync (docs/PROJECTS.md § Sync, docs/DESKTOP.md § Sync): maps changed in the in-game editor are found on launch, on
 * focus and when a Play's game session ends, and Re-import takes the game's version into the project.
 */
import { Deferred, Effect, Stream } from "effect"
import { mapLabelOf } from "../../domain/factory"
import { MapCodec } from "../../services/MapCodec"
import { Platform } from "../../services/Platform"
import { useEditor } from "../store"
import { notifyFailure, run, runUntilCleanup } from "./run"
import { fileOf, refreshProject, showMap } from "./shared"
import { unlessCancelledFor } from "./unsaved"

/** Tells that the game changed a map's export, with Re-import and Ignore. */
const notifyChangedInGame = (fileName: string) =>
  useEditor.getState().notify("info", `${mapLabelOf(fileName)} was changed in the game`, {
    kind: "changedInGame",
    body: "Re-import replaces the map in the project with the game's version; the project's goes to the backups.",
    actions: [
      { label: "Re-import", command: { _tag: "ReimportMap", fileName } },
      { label: "Ignore", command: { _tag: "Dismiss" } }
    ]
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
  for (const fileName of changed) notifyChangedInGame(fileName)
}).pipe(Effect.catch((error) => Effect.logWarning("Couldn't check the maps exported to the game", error)))

/** The check running now, if any. */
let runningCheck: Deferred.Deferred<void> | null = null

/**
 * Sync detection, on launch, on window focus and when a Play's game session ends. A check asked for while one runs
 * joins it rather than looking again: the game closing usually brings both the focus and the end of the session.
 */
export const checkExportsEffect: Effect.Effect<void, never, Platform> = Effect.suspend(() => {
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
 * records it as in sync. A tab that has the map open is made active and reloaded from it, after asking about its
 * unsaved edits.
 */
export const reimportMapEffect = (fileName: string) =>
  unlessCancelledFor(fileName, "reimport", (open) =>
    Effect.gen(function*() {
      const file = yield* (yield* Platform).reimportMap(fileName)
      if (open) yield* showMap(yield* MapCodec.use((codec) => codec.decode(file.text)), fileOf(file))
      yield* refreshProject
      useEditor.getState().notify("info", `Re-imported ${mapLabelOf(fileName)} from the game`, {
        kind: "mapReimported",
        body: "The project's previous version is in the backups (Project › Recover previous version…).",
        actions: open ? [] : [{ label: "Open", command: { _tag: "OpenMap", fileName } }]
      })
    }))

export const reimportMap = (fileName: string) => run(reimportMapEffect(fileName))

/** The overwriteChanged dialog's Re-import first: the game's version replaces the project's; nothing is exported. */
export const reimportFirstEffect = Effect.suspend(() => {
  const { dialog: changed, closeDialog } = useEditor.getState()
  closeDialog()
  return changed?.id === "overwriteChanged" ? reimportMapEffect(changed.name) : Effect.void
})

export const reimportFirst = () => run(reimportFirstEffect)

/**
 * A game session Play started or joined has ended: the game may have changed the export (the in-game editor saves
 * over it), so the exports are checked.
 */
const playSessionEnded = Effect.suspend(() => checkExportsEffect)

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
