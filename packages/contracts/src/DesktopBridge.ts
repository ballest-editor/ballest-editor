import { Schema } from "effect"

/** Runtime versions of the desktop app, for bug reports and the about dialog. */
export const DesktopVersions = Schema.Struct({
  electron: Schema.String,
  chrome: Schema.String,
  node: Schema.String
})
export type DesktopVersions = typeof DesktopVersions.Type

/**
 * What the desktop preload exposes to the renderer as `window.ballest`. The renderer only sees this interface, so
 * everything crossing it is plain data (structured-clone safe); schemas for IPC payloads and results live next to
 * the methods that use them.
 */
export interface DesktopBridge {
  readonly versions: DesktopVersions
}
