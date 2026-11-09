import { type DesktopMethodName, DesktopMethods } from "@ballest/contracts"
import { Effect, Record } from "effect"
import { DesktopIpc, type DesktopIpcHandlers, makeIpcMethod } from "./DesktopIpc"
import { gameHandlers } from "./methods/game"
import { notificationHandlers } from "./methods/notifications"
import { pingHandlers } from "./methods/ping"
import { projectHandlers } from "./methods/project"
import { shellHandlers } from "./methods/shell"
import { updateHandlers } from "./methods/updates"
import { usageHandlers } from "./methods/usage"
import { windowHandlers } from "./methods/window"

/** One handler per method in `DesktopMethods`: a method without one fails typecheck here. */
const handlers = {
  ...pingHandlers,
  ...projectHandlers,
  ...windowHandlers,
  ...shellHandlers,
  ...gameHandlers,
  ...notificationHandlers,
  ...updateHandlers,
  ...usageHandlers
} satisfies DesktopIpcHandlers

/** The services the handlers need, together. */
type HandlerServices = {
  readonly [K in DesktopMethodName]: Effect.Services<ReturnType<(typeof handlers)[K]>>
}[DesktopMethodName]

/** Registers every IPC method for the lifetime of the current scope. Runs before the first window loads. */
export const installDesktopIpcHandlers = Effect.fn("installDesktopIpcHandlers")(function*() {
  const ipc = yield* DesktopIpc
  const all: DesktopIpcHandlers<unknown, HandlerServices> = handlers
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- K ties `name` to `all[name]` (else a union)
  const register = <K extends DesktopMethodName>(name: K) => ipc.handle(makeIpcMethod(name, all[name]))
  yield* Effect.forEach(Record.keys(DesktopMethods), register, { discard: true })
})
