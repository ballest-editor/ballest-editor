import { Schema } from "effect"

/** Runtime versions of the desktop app, for bug reports and the about dialog. */
export const DesktopVersions = Schema.Struct({
  electron: Schema.String,
  chrome: Schema.String,
  node: Schema.String
})
export type DesktopVersions = typeof DesktopVersions.Type

/** `ping`'s payload: anything the renderer wants echoed back, to check the IPC round trip. */
export const PingPayload = Schema.Struct({
  message: Schema.String.check(Schema.isMaxLength(1024))
})
export type PingPayload = typeof PingPayload.Type

export const PingResult = Schema.Struct({
  message: Schema.String
})
export type PingResult = typeof PingResult.Type

/**
 * What the desktop preload exposes to the renderer as `window.ballest`. The renderer only sees this interface, so
 * everything crossing it is plain data (structured-clone safe). Main decodes every payload and encodes every result
 * with the schemas above; a payload that fails to decode rejects the returned promise.
 */
export interface DesktopBridge {
  readonly versions: DesktopVersions
  /** Echoes `message` back from the main process. */
  readonly ping: (message: string) => Promise<PingResult>
}
