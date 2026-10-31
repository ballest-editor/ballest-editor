import { WindowThemePayload } from "@ballest/contracts"
import { Effect, Schema } from "effect"
import { ElectronWindow } from "../../electron/ElectronWindow"
import { titleBarOverlay, windowBackground } from "../../window/chrome"
import { SET_WINDOW_THEME_CHANNEL } from "../channels"
import { makeIpcMethod } from "../DesktopIpc"

/** Recolours the sender's window controls and background to the page's theme. */
export const setWindowTheme = makeIpcMethod({
  channel: SET_WINDOW_THEME_CHANNEL,
  payload: WindowThemePayload,
  result: Schema.Void,
  handler: Effect.fn("ipc.setWindowTheme")(function*({ dark }, event) {
    yield* (yield* ElectronWindow).setColors(event.sender.id, {
      overlay: titleBarOverlay(dark),
      background: windowBackground(dark)
    })
  })
})
