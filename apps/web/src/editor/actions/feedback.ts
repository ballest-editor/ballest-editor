/** Help › Send feedback and anonymous usage statistics (docs/DESKTOP.md § Feedback and usage statistics). */
import { Effect } from "effect"
import { type FeedbackForm, Platform } from "../../services/Platform"
import { runtime } from "../../services/runtime"
import { useEditor } from "../store"
import { run } from "./run"

/** The first-launch notice: what is sent, and where to turn it off. */
export const USAGE_NOTICE = {
  title: "Ballest Editor sends anonymous usage statistics",
  body: "How long it runs, its version and platform, and errors with paths and names taken out. Never your maps. "
    + "Turn it off in Settings › General."
} as const

/**
 * Usage statistics' state into the store (desktop). On the first launch that sends them, the notice saying what is
 * sent goes to the notification centre, and main remembers it was shown.
 */
export const loadUsageStatsEffect = Effect.gen(function*() {
  const platform = yield* Platform
  if (!platform.capabilities.feedback) return
  const state = yield* platform.usageStats
  // Two loads at once (StrictMode's double effects) both see it unshown; the check and the notify run together, so
  // the second sees the first's notice.
  const shownNow = useEditor.getState().notifications.some((n) => n.kind === "usageStats")
  if (state.collecting && state.enabled && !state.noticeShown && !shownNow) {
    useEditor.getState().notify("info", USAGE_NOTICE.title, {
      kind: "usageStats",
      body: USAGE_NOTICE.body,
      actions: [{ label: "Settings", command: { _tag: "OpenSettings" } }]
    })
    useEditor.getState().setUsageStats(yield* platform.setUsageStats({ noticeShown: true }))
  } else {
    useEditor.getState().setUsageStats(state)
  }
})

/** Settings › General's switch. Off, main drops the install id and every event not yet sent. */
export const setUsageStatsEnabled = (enabled: boolean) =>
  run(
    Effect.gen(function*() {
      useEditor.getState().setUsageStats(yield* (yield* Platform).setUsageStats({ enabled }))
    })
  )

/** Sends the form; true once it is an issue (its toast links to it), false with a toast saying why not. */
export const sendFeedbackEffect = (form: FeedbackForm) =>
  Effect.gen(function*() {
    const result = yield* (yield* Platform).sendFeedback(form)
    const { notify } = useEditor.getState()
    switch (result._tag) {
      case "Sent":
        notify("info", `Thanks! Your feedback is issue #${result.issueNumber}.`, {
          kind: "feedbackSent",
          actions: [{ label: "View issue", command: { _tag: "OpenExternal", url: result.issueUrl } }]
        })
        return true
      case "RateLimited":
        notify("error", "That's a lot of feedback from this network. Try again in an hour.")
        return false
      case "Unavailable":
        notify("error", "Only an installed Ballest Editor sends feedback.")
        return false
      case "Failed":
        notify("error", "Couldn't send your feedback. It's still in the form.", { body: result.message })
        return false
    }
  })

export const sendFeedback = async (form: FeedbackForm): Promise<boolean> =>
  (await run(sendFeedbackEffect(form))) === true

/** What an `error` or `unhandledrejection` event carries, as a message and a stack. */
const describe = (reason: unknown): { readonly message: string; readonly stack: string } =>
  reason instanceof Error
    ? { message: `${reason.name}: ${reason.message}`, stack: reason.stack ?? "" }
    : { message: String(reason), stack: "" }

/**
 * Hands the page's uncaught errors and unhandled rejections to main for usage statistics (which keeps them only while
 * they are on), until the returned function is called: a React effect's cleanup. A failure to report is dropped.
 */
export const followPageErrors = (): () => void => {
  const report = (reason: unknown) => {
    const { message, stack } = describe(reason)
    runtime.runFork(Effect.flatMap(Effect.service(Platform), (p) => p.reportError(message, stack)).pipe(Effect.ignore))
  }
  const onError = (event: ErrorEvent) => report(event.error ?? event.message)
  const onRejection = (event: PromiseRejectionEvent) => report(event.reason)
  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)
  return () => {
    window.removeEventListener("error", onError)
    window.removeEventListener("unhandledrejection", onRejection)
  }
}
