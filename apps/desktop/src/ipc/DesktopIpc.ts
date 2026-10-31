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

/**
 * An IPC method whose payload is decoded and whose result is encoded with Schema, so the handler only ever sees
 * valid input and the renderer only ever gets the contract's encoded shape.
 */
export const makeIpcMethod = <Payload, EncodedPayload, Result, EncodedResult, E, R>(method: {
  readonly channel: string
  readonly payload: Schema.Codec<Payload, EncodedPayload>
  readonly result: Schema.Codec<Result, EncodedResult>
  readonly handler: (payload: Payload, event: DesktopIpcInvokeEvent) => Effect.Effect<Result, E, R>
}): DesktopIpcMethod<E | Schema.SchemaError, R> => {
  const decode = Schema.decodeUnknownEffect(method.payload)
  const encode = Schema.encodeEffect(method.result)
  return {
    channel: method.channel,
    handler: (raw, event) =>
      decode(raw).pipe(
        Effect.flatMap((payload) => method.handler(payload, event)),
        Effect.flatMap(encode),
        Effect.withSpan("DesktopIpc.method", { attributes: { channel: method.channel } })
      )
  }
}
