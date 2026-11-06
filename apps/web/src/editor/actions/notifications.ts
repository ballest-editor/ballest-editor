/** Notifications (docs/DESKTOP.md § Renderer): their buttons, toasts, Don't show again, and the log kept across runs. */
import { Effect, Queue, Stream } from "effect"
import { toast } from "sonner"
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
import { reimportMap } from "./sync"

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

const toastNotification = (notice: NotificationRecord) => {
  const [first] = notice.actions
  const options = {
    ...(notice.body !== null && { description: notice.body }),
    ...(first !== undefined && {
      action: { label: first.label, onClick: () => runNotificationAction(notice, first) }
    })
  }
  if (notice.level === "error") toast.error(notice.title, options)
  else toast(notice.title, options)
}

/** When this run of the editor began: a notification from before it was kept from an earlier run, not news. */
const sessionStart = Date.now()

/**
 * Toasts each new notification (its first button on the toast) until the returned function is called: a React effect's
 * cleanup. The toast goes away by itself; the notification stays in the notification centre.
 */
export const showToasts = (): () => void => {
  const shown = new Set<string>()
  const showNew = (log: ReadonlyArray<NotificationRecord>) => {
    // oldest first, so the newest is on top
    for (const notice of log.toReversed()) {
      if (shown.has(notice.id) || Date.parse(notice.at) < sessionStart) continue
      shown.add(notice.id)
      toastNotification(notice)
    }
  }
  showNew(useEditor.getState().notifications)
  return useEditor.subscribe((state, previous) => {
    if (state.notifications !== previous.notifications) showNew(state.notifications)
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
