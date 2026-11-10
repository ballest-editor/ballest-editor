import type { UnsavedChoice } from "@ballest/contracts"
import { Effect } from "effect"
import { ElectronDialog } from "../../electron/ElectronDialog"
import { ElectronWindow } from "../../electron/ElectronWindow"
import { popoutOverlay, titleBarOverlay, windowBackground } from "../../window/chrome"
import { WindowStage } from "../../window/WindowStage"
import type { DesktopIpcHandlers } from "../DesktopIpc"

/** The buttons in the order they are drawn, each with the answer it gives; Cancel is also Escape. */
const UNSAVED_BUTTONS = [
  { label: "Save", choice: "save" },
  { label: "Don't save", choice: "discard" },
  { label: "Cancel", choice: "cancel" }
] as const satisfies ReadonlyArray<{ readonly label: string; readonly choice: UnsavedChoice }>

export const windowHandlers = {
  /** Recolours the sender's window controls and background to the page's theme. */
  setWindowTheme: Effect.fn("ipc.setWindowTheme")(function*({ dark }, event) {
    yield* (yield* ElectronWindow).setColors(event.sender.id, {
      overlay: titleBarOverlay(dark),
      popoutOverlay: popoutOverlay(titleBarOverlay(dark)),
      background: windowBackground(dark)
    })
  }),
  /** Grows the welcome window into the editor, and completes once it has. */
  showEditor: () => Effect.flatMap(Effect.service(WindowStage), (stage) => stage.showEditor),
  /** The unsaved-changes prompt, modal to the sender's window: before a close, a reload or replacing the open map. */
  confirmUnsaved: Effect.fn("ipc.confirmUnsaved")(function*({ message, detail }, event) {
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
} satisfies Partial<DesktopIpcHandlers>
