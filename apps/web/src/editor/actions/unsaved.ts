/**
 * Unsaved changes (docs/DESKTOP.md § Window): one prompt per map before anything that would lose its edits, and the
 * window's held closes and reloads, which ask about every tab with unsaved edits.
 */
import { Effect, Stream } from "effect"
import type { UnsavedAction } from "../../domain/unsaved"
import { Platform, type UnloadKind } from "../../services/Platform"
import { dirtyTabs, inNamedProject, tabWithFile, useEditor } from "../store"
import { freshMapEffect } from "./maps"
import { dropRecovery } from "./recoverySnapshots"
import { notifyFailure, run, runUntilCleanup } from "./run"
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
 * Runs `next` unless the open map (the active tab's) has unsaved edits and the user cancels. With unsaved edits the
 * platform asks first (Save, Don't save, Cancel): Save saves the map, naming it first if it has to, then goes on; Don't
 * save goes on.
 */
export const unlessCancelled = <E, R>(action: UnsavedAction, next: Effect.Effect<void, E, R>) =>
  Effect.gen(function*() {
    if (!useEditor.getState().dirty) return yield* next
    const choice = yield* (yield* Platform).confirmUnsaved(action, openMapName())
    if (choice === "save") yield* saveOpenMapThen(next)
    else if (choice === "discard") yield* next
  })

/** What `unlessCancelled` makes of an Effect that fails with `E` and needs `R`. */
type Asked<E, R> = ReturnType<typeof unlessCancelled<E, R>>

/**
 * Runs `next` unless the user cancels for one of the tabs with unsaved edits: each is made the active tab in turn and
 * asked about (`unlessCancelled`), and the first Cancel stops there.
 */
export const unlessAnyCancelled = <E, R>(
  action: UnsavedAction,
  next: Effect.Effect<void, E, R>,
  asked: ReadonlySet<string> = new Set()
): Asked<E, R> =>
  Effect.suspend(() => {
    const tabId = dirtyTabs(useEditor.getState()).find((id) => !asked.has(id))
    if (tabId === undefined) return next
    useEditor.getState().activateTab(tabId)
    return unlessCancelled(action, unlessAnyCancelled(action, next, new Set([...asked, tabId])))
  })

/**
 * Runs `next` for what tab `tabId` has open, which is about to be replaced: that tab is made active and asked about first
 * (`unlessCancelled`), and `next` hears `true`. With no such tab it runs at once with `false`.
 */
export const unlessCancelledIn = <E, R>(
  tabId: string | undefined,
  action: UnsavedAction,
  next: (open: boolean) => Effect.Effect<void, E, R>
) =>
  Effect.suspend(() => {
    if (tabId === undefined) return next(false)
    useEditor.getState().activateTab(tabId)
    return unlessCancelled(action, next(true))
  })

/** `unlessCancelledIn` the tab that has the project map `fileName` open. */
export const unlessCancelledFor = <E, R>(
  fileName: string,
  action: UnsavedAction,
  next: (open: boolean) => Effect.Effect<void, E, R>
) => Effect.suspend(() => unlessCancelledIn(tabWithFile(useEditor.getState(), fileName), action, next))

/** Whether the page holds a close or a reload (its `beforeunload` cancels it) so the prompt can ask first. */
export const holdsUnload = () => dirtyTabs(useEditor.getState()).length > 0 && !leaving

/** The desktop window held a close or a reload: asks about each map with unsaved edits, then closes or reloads. */
export const answerUnloadRequest = (kind: UnloadKind) =>
  unlessAnyCancelled(
    kind,
    Effect.gen(function*() {
      leaving = true
      // every tab was answered for: nothing here is for the next launch to offer
      yield* dropRecovery
      yield* (yield* Platform).leave(kind)
    })
  )

/** Answers the window's held closes and reloads (`answerUnloadRequest`) until the returned function is called. */
export const followUnloadRequests = () =>
  runUntilCleanup(
    Effect.gen(function*() {
      yield* (yield* Platform).unloadRequests.pipe(
        Stream.runForEach((kind) =>
          answerUnloadRequest(kind).pipe(Effect.catchCause((cause) => Effect.sync(() => notifyFailure(cause))))
        )
      )
    }),
    "Stopped following the window's close requests"
  )

/**
 * Closes a tab, asking about its unsaved edits first (it is made the active tab to ask), then runs `then`. Closing the
 * last tab leaves the project overview in a named project, and elsewhere, with nothing to list, a fresh, unsaved map in
 * its place. A Cancel runs nothing more, and a Save that names the document first runs the rest once its dialog saves.
 */
export const closeTabEffect = <E = never, R = never>(tabId: string, then: Effect.Effect<void, E, R> = Effect.void) =>
  Effect.suspend(() => {
    const { tabIds, activateTab } = useEditor.getState()
    if (!tabIds.includes(tabId)) return then
    activateTab(tabId)
    return unlessCancelled(
      "closeTab",
      Effect.suspend(() => {
        const s = useEditor.getState()
        if (s.tabIds.length > 1 || inNamedProject(s)) return Effect.sync(() => s.closeTab(tabId))
        return freshMapEffect
      }).pipe(Effect.andThen(then))
    )
  })

export const closeTab = (tabId: string) => run(closeTabEffect(tabId))

/**
 * Closes `tabIds` one after the other (`closeTabEffect` each), then makes `keep` active. A Cancel stops there, on the
 * tab it asked about, and a tab being named first goes on once its dialog has saved.
 */
export const closeTabsBesideEffect = (keep: string, tabIds: ReadonlyArray<string>) =>
  tabIds.reduceRight<Closing>(
    (rest, id) => closeTabEffect(id, rest),
    Effect.sync(() => useEditor.getState().activateTab(keep))
  )

/** What closing a tab fails with and needs. */
type Closing = ReturnType<typeof closeTabEffect<never, never>>

const closeTabsBeside = (keep: string, tabIds: ReadonlyArray<string>) => run(closeTabsBesideEffect(keep, tabIds))

/** Closes the active tab (`closeTab`). */
export const closeActiveTab = () => closeTab(useEditor.getState().tabId)

/** Closes every tab but `tabId`, asking about each one's unsaved edits in turn; `tabId` is left active. */
export const closeOtherTabs = (tabId: string) =>
  closeTabsBeside(tabId, useEditor.getState().tabIds.filter((id) => id !== tabId))

/** Closes the tabs after `tabId`, asking about each one's unsaved edits in turn; `tabId` is left active. */
export const closeTabsToRight = (tabId: string) => {
  const { tabIds } = useEditor.getState()
  return closeTabsBeside(tabId, tabIds.slice(tabIds.indexOf(tabId) + 1))
}

/** Makes the next tab active (`step` 1) or the previous one (-1), wrapping around. */
export const cycleTab = (step: 1 | -1) => {
  const { tabIds, tabId, activateTab } = useEditor.getState()
  const next = tabIds[(tabIds.indexOf(tabId) + step + tabIds.length) % tabIds.length]
  if (next !== undefined) activateTab(next)
}

/** File › Quit: the same as closing the window, so unsaved edits ask first (docs/DESKTOP.md § Window). */
export const quitApp = () => run(answerUnloadRequest("close"))
