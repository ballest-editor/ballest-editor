import { UnsavedChoice, UnsavedPrompt, WindowThemePayload } from "@ballest/contracts"
import { Effect, Schema } from "effect"
import { ElectronDialog } from "../../electron/ElectronDialog"
import { ElectronWindow } from "../../electron/ElectronWindow"
import { titleBarOverlay, windowBackground } from "../../window/chrome"
import { CONFIRM_UNSAVED_CHANNEL, SET_WINDOW_THEME_CHANNEL } from "../channels"
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

/** The buttons in the order they are drawn, each with the answer it gives; Cancel is also Escape. */
const UNSAVED_BUTTONS = [
  { label: "Save", choice: "save" },
  { label: "Don't save", choice: "discard" },
  { label: "Cancel", choice: "cancel" }
] as const satisfies ReadonlyArray<{ readonly label: string; readonly choice: UnsavedChoice }>

/** The unsaved-changes prompt, modal to the sender's window: before a close, a reload or replacing the open map. */
export const confirmUnsaved = makeIpcMethod({
  channel: CONFIRM_UNSAVED_CHANNEL,
  payload: UnsavedPrompt,
  result: UnsavedChoice,
  handler: Effect.fn("ipc.confirmUnsaved")(function*({ message, detail }, event) {
    const picked = yield* (yield* ElectronDialog).showMessageBox({
      owner: event.sender.id,
      type: "warning",
      message,
      detail,
      buttons: UNSAVED_BUTTONS.map((button) => button.label),
      cancelId: UNSAVED_BUTTONS.length - 1
    })
    return UNSAVED_BUTTONS[picked]?.choice ?? "cancel"
  })
})
