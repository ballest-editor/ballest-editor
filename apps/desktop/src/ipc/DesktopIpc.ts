import { type DesktopMethodName, DesktopMethods, InvokeChannels } from "@ballest/contracts"
import { Context, Effect, Layer, Schema, type Scope } from "effect"

/** The part of an invoke event the handlers may look at. */
export interface DesktopIpcInvokeEvent {
  readonly sender: { readonly id: number }
}

export type DesktopIpcHandleListener = (event: DesktopIpcInvokeEvent, raw: unknown) => Promise<unknown>

/**
 * The slice of Electron's `ipcMain` this service uses. `main.ts` passes the real one; tests pass a fake, so nothing
 * here (or in `ipc/methods/`) loads `electron` at runtime.
 */
export interface DesktopIpcMain {
  handle(channel: string, listener: DesktopIpcHandleListener): void
  removeHandler(channel: string): void
}

export class DesktopIpcRegistrationError extends Schema.TaggedError<DesktopIpcRegistrationError>()(
  "DesktopIpcRegistrationError",
  { channel: Schema.String, cause: Schema.Defect() }
) {
  override get message(): string {
    return `Failed to register the IPC handler for ${this.channel}.`
  }
}

/** One `ipcRenderer.invoke` channel: its raw payload in, its encoded result out. */
export interface DesktopIpcMethod<E, R> {
  readonly channel: string
  readonly handler: (raw: unknown, event: DesktopIpcInvokeEvent) => Effect.Effect<unknown, E, R>
}

export class DesktopIpc extends Context.Service<DesktopIpc, {
  /** Registers `method` on its channel until the scope closes. A failed handler rejects the renderer's promise. */
  readonly handle: <E, R>(
    method: DesktopIpcMethod<E, R>
  ) => Effect.Effect<void, DesktopIpcRegistrationError, R | Scope.Scope>
}>()("ballest/desktop/ipc/DesktopIpc") {
  static readonly make = (ipcMain: DesktopIpcMain): DesktopIpc["Service"] =>
    DesktopIpc.of({
      handle: Effect.fn("DesktopIpc.handle")(function*<E, R>({ channel, handler }: DesktopIpcMethod<E, R>) {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<R>())
        yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              ipcMain.removeHandler(channel)
              ipcMain.handle(channel, (event, raw) =>
                runPromise(
                  handler(raw, event).pipe(Effect.annotateLogs({ channel }), Effect.withSpan("DesktopIpc.invoke"))
                ))
            },
            catch: (cause) => new DesktopIpcRegistrationError({ channel, cause })
          }),
          () => Effect.sync(() => ipcMain.removeHandler(channel))
        )
      })
    })

  static readonly layer = (ipcMain: DesktopIpcMain) => Layer.succeed(DesktopIpc, DesktopIpc.make(ipcMain))
}

/** A bridge method's payload as its handler gets it: decoded. */
type HandlerPayload<K extends DesktopMethodName> = (typeof DesktopMethods)[K]["payload"]["Type"]

/** A bridge method's result as its handler gives it: before encoding. */
type HandlerResult<K extends DesktopMethodName> = (typeof DesktopMethods)[K]["result"]["Type"]

/** The work behind bridge method `K`: its decoded payload and the sender in, its result out. */
export type DesktopIpcHandler<K extends DesktopMethodName, E = unknown, R = unknown> = (
  payload: HandlerPayload<K>,
  event: DesktopIpcInvokeEvent
) => Effect.Effect<HandlerResult<K>, E, R>

/**
 * A handler for every method in `DesktopMethods`. Each file in `methods/` holds an area's (`satisfies
 * Partial<DesktopIpcHandlers>`); `DesktopIpcHandlers.ts` puts them together and fails typecheck when one is missing.
 */
export type DesktopIpcHandlers<E = unknown, R = unknown> = {
  readonly [K in DesktopMethodName]: DesktopIpcHandler<K, E, R>
}

/**
 * Bridge method `name` on its channel (`InvokeChannels`), its payload decoded and its result encoded with its schemas
 * (`DesktopMethods`), so the handler only ever sees valid input and the renderer only ever gets the contract's encoded
 * shape.
 */
export const makeIpcMethod = <K extends DesktopMethodName, E, R>(
  name: K,
  handler: DesktopIpcHandler<K, E, R>
): DesktopIpcMethod<E | Schema.SchemaError, R> => {
  const channel = InvokeChannels[name]
  const schemas: {
    readonly payload: Schema.ConstraintCodec<HandlerPayload<K>, unknown>
    readonly result: Schema.ConstraintCodec<HandlerResult<K>, unknown>
  } = DesktopMethods[name]
  const decode = Schema.decodeUnknownEffect(schemas.payload)
  const encode = Schema.encodeEffect(schemas.result)
  return {
    channel,
    handler: (raw, event) =>
      decode(raw).pipe(
        Effect.flatMap((payload) => handler(payload, event)),
        Effect.flatMap(encode),
        Effect.withSpan("DesktopIpc.method", { attributes: { channel } })
      )
  }
}
