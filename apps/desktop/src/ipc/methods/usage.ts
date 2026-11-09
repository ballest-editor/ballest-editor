import { FeedbackReceipt, type SendFeedbackResult } from "@ballest/contracts"
import { Effect, Option, Schema } from "effect"
import { CollectClient } from "../../usage/CollectClient"
import { UsageStats } from "../../usage/UsageStats"
import type { DesktopIpcHandlers } from "../DesktopIpc"

const decodeReceipt = Schema.decodeUnknownEffect(FeedbackReceipt)

export const usageHandlers = {
  /** Posts the form with the app's facts; the endpoint makes the issue and keeps the names to itself. */
  sendFeedback: Effect.fn("ipc.sendFeedback")(function*(form) {
    const collect = yield* CollectClient
    if (Option.isNone(collect.endpoint)) return { _tag: "Unavailable" } satisfies SendFeedbackResult
    return yield* collect.post("/api/feedback", form).pipe(
      Effect.flatMap(decodeReceipt),
      Effect.map((receipt): SendFeedbackResult => ({ _tag: "Sent", ...receipt })),
      Effect.catch((error) =>
        Effect.logWarning("Couldn't send feedback", error.message).pipe(
          Effect.as<SendFeedbackResult>(
            error._tag === "CollectError" && error.status === 429
              ? { _tag: "RateLimited" }
              : { _tag: "Failed", message: error.message }
          )
        )
      )
    )
  }),
  usageStats: Effect.fn("ipc.usageStats")(function*() {
    return yield* (yield* UsageStats).state
  }),
  setUsageStats: Effect.fn("ipc.setUsageStats")(function*(patch) {
    return yield* (yield* UsageStats).set(patch)
  }),
  reportError: Effect.fn("ipc.reportError")(function*({ message, stack }) {
    yield* (yield* UsageStats).recordError("renderer", message, stack)
  })
} satisfies Partial<DesktopIpcHandlers>
