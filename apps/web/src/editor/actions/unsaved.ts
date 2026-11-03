/**
 * Unsaved changes (docs/DESKTOP.md § Window): one prompt before anything that would lose them, and the window's held
 * closes and reloads.
 */
import { Effect, Fiber, Stream } from "effect"
import type { UnsavedAction } from "../../domain/unsaved"
import { Platform, type UnloadKind } from "../../services/Platform"
import { runtime } from "../../services/runtime"
import { useEditor } from "../store"
import { notifyFailure, run } from "./run"
import { saveOpenMapThen } from "./save"

/**
 * Set once the page is about to close or reload after all (the prompt was answered, or the update pill restarts):
 * from then on it doesn't hold the unload.
 */
let leaving = false

/** Runs `effect` with the page leaving (the update pill's restart): it holds no unload meanwhile, unless `effect` fails. */
export const leavingFor = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.sync(() => void (leaving = true)).pipe(
    Effect.andThen(effect),
    Effect.tapError(() => Effect.sync(() => void (leaving = false)))
  )

/** The open map's name, as the prompt shows it. */
const openMapName = () => useEditor.getState().doc.map.worldSettings.levelData.levelDisplayName.trim() || "Untitled"

/**
 * Runs `next` unless the open map has unsaved edits and the user cancels. With unsaved edits the platform asks first
 * (Save, Don't save, Cancel): Save saves the map, naming it first if it has to, then goes on; Don't save goes on.
 */
export const unlessCancelled = <E, R>(action: UnsavedAction, next: Effect.Effect<void, E, R>) =>
  Effect.gen(function*() {
    if (!useEditor.getState().dirty) return yield* next
    const choice = yield* (yield* Platform).confirmUnsaved(action, openMapName())
    if (choice === "save") yield* saveOpenMapThen(next)
    else if (choice === "discard") yield* next
  })

/** Whether the page holds a close or a reload (its `beforeunload` cancels it) so the prompt can ask first. */
export const holdsUnload = () => useEditor.getState().dirty && !leaving

/** The desktop window held a close or a reload: asks, then closes or reloads unless the user cancelled. */
export const answerUnloadRequest = (kind: UnloadKind) =>
  unlessCancelled(
    kind,
    Effect.gen(function*() {
      leaving = true
      yield* (yield* Platform).leave(kind)
    })
  )

/** Answers the window's held closes and reloads (`answerUnloadRequest`) until the returned function is called. */
export const followUnloadRequests = (): () => void => {
  const fiber = runtime.runFork(
    Effect.gen(function*() {
      yield* (yield* Platform).unloadRequests.pipe(
        Stream.runForEach((kind) =>
          answerUnloadRequest(kind).pipe(Effect.catchCause((cause) => Effect.sync(() => notifyFailure(cause))))
        )
      )
    }).pipe(Effect.catch((error) => Effect.logWarning("Stopped following the window's close requests", error)))
  )
  return () => void runtime.runFork(Fiber.interrupt(fiber))
}

/** New map: asks about unsaved edits first, then the New map dialog (name and creator). */
export const startNewMapEffect = unlessCancelled(
  "newMap",
  Effect.sync(() => useEditor.getState().openDialog("new"))
)

export const startNewMap = () => run(startNewMapEffect)

/** File › Quit: the same as closing the window, so unsaved edits ask first (docs/DESKTOP.md § Window). */
export const quitApp = () => run(answerUnloadRequest("close"))
