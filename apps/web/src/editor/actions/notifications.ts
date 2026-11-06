/** Notifications (docs/DESKTOP.md § Notifications): their buttons, toasts, Don't show again, and the log kept across runs. */
import { Effect, Queue, Stream } from "effect"
import {
  type NotificationAction,
  type NotificationCommand,
  type NotificationRecord,
  Platform
} from "../../services/Platform"
import { useEditor } from "../store"
import { chooseGamePath, installPlugin, openExternalLink, revealGamePath } from "./gameLink"
import { revealProject } from "./maps"
import { detachEditedInstances, updateEditedInstances } from "./prefabs"
import { openProjectMap } from "./project"
import { run, runUntilCleanup } from "./run"
import { reimportMap, resolveConflict } from "./sync"

/** Runs a notification's button. */
export const runNotificationCommand = (command: NotificationCommand): void => {
  switch (command._tag) {
    case "RevealProject":
      void revealProject()
      return
    case "RevealGamePath":
      void revealGamePath(command.which)
      return
    case "ChooseGamePath":
      void chooseGamePath(command.which)
      return
    case "OpenMap":
      void openProjectMap(command.fileName)
      return
    case "ReimportMap":
      void reimportMap(command.fileName)
      return
    case "ResolveConflict":
      void resolveConflict(command.fileName)
      return
    case "UpdatePrefabInstances":
      void updateEditedInstances(command)
      return
    case "DetachPrefabInstances":
      detachEditedInstances(command)
      return
    case "Dismiss":
      return
    case "OpenExternal":
      void openExternalLink(command.url)
      return
    case "InstallPlugin":
      void installPlugin()
  }
}

/** "Don't show again" on a notification: its kind is muted from now on, across restarts (desktop). */
export const muteNotificationKindEffect = (kind: string) =>
  Effect.gen(function*() {
    useEditor.getState().muteNotifications(yield* (yield* Platform).muteNotifications(kind))
  })

export const muteNotificationKind = (kind: string) => run(muteNotificationKindEffect(kind))

/** A notification's button, from its toast or the notification centre: it is read once acted on. */
export const runNotificationAction = (notice: NotificationRecord, action: NotificationAction) => {
  useEditor.getState().markNotificationsRead([notice.id])
  runNotificationCommand(action.command)
}

/**
 * Hands each toast `notify` routed here (`belongsInInbox`) to `present`, the waiting ones first, oldest first so the
 * newest is on top, until the returned function is called: a React effect's cleanup.
 */
export const showToasts = (present: (notice: NotificationRecord) => void): () => void => {
  const showWaiting = () => {
    const { toasts } = useEditor.getState()
    if (toasts.length === 0) return
    useEditor.setState({ toasts: [] })
    for (const notice of toasts.toReversed()) present(notice)
  }
  showWaiting()
  return useEditor.subscribe((state, previous) => {
    if (state.toasts !== previous.toasts) showWaiting()
  })
}

/**
 * Restores the notifications kept from earlier runs under this session's, then keeps the list after every change, one
 * write at a time (desktop: `notifications.json`; a browser forgets them). Runs until interrupted. A failed write is
 * only logged: reporting it would be another notification to write.
 */
export const keepNotifications = Effect.gen(function*() {
  const platform = yield* Platform
  const kept = yield* platform.loadNotifications
  const changes = Stream.callback<ReadonlyArray<NotificationRecord>>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const unsubscribe = useEditor.subscribe((state, previous) => {
          if (state.notifications !== previous.notifications) Queue.offerUnsafe(queue, state.notifications)
        })
        // the merged list is the first change written
        useEditor.getState().restoreNotifications(kept)
        return unsubscribe
      }),
      (unsubscribe) => Effect.sync(unsubscribe)
    )
  )
  yield* changes.pipe(
    Stream.runForEach((records) =>
      platform.saveNotifications(records).pipe(
        Effect.catch((error) => Effect.logWarning("Couldn't keep the notifications", error))
      )
    )
  )
})

/** Keeps the notifications (`keepNotifications`) until the returned function is called: a React effect's cleanup. */
export const followNotifications = () => runUntilCleanup(keepNotifications, "Couldn't read the kept notifications")
