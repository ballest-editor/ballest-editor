/** Runs the actions' Effects through the single app runtime; internal to `editor/actions`, not re-exported. */
import { Cause, Effect, Exit, Fiber } from "effect"
import { type AppServices, runtime } from "../../services/runtime"
import { useEditor } from "../store"

export const notifyFailure = <E>(cause: Cause.Cause<E>) => {
  const error = Cause.squash(cause)
  const message = typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error)
  useEditor.getState().notify("error", message)
}

export const run = async <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A | undefined> => {
  const exit = await runtime.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  notifyFailure(exit.cause)
  return undefined
}

/** Runs `effect` in the background until the returned function is called (a React effect's cleanup); failures are logged. */
export const runUntilCleanup = <E>(effect: Effect.Effect<void, E, AppServices>, failure: string): () => void => {
  const fiber = runtime.runFork(effect.pipe(Effect.catch((error) => Effect.logWarning(failure, error))))
  return () => void runtime.runFork(Fiber.interrupt(fiber))
}
