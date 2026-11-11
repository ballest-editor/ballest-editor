import { Context, type Effect, type Option, Schema } from "effect"
import type * as Electron from "electron"

export class ElectronDialogError extends Schema.TaggedError<ElectronDialogError>()("ElectronDialogError", {
  kind: Schema.Literals(["open", "save", "folder", "message"]),
  cause: Schema.Defect()
}) {
  override get message(): string {
    return `The ${this.kind} dialog failed to open.`
  }
}

export interface FileDialogOptions {
  /** The `webContents` that asked (an IPC event's sender): the dialog is modal to its window. */
  readonly owner: number
  readonly title: string
  /** A folder, or a file in the folder to start in (the save dialog suggests its name). */
  readonly defaultPath: Option.Option<string>
  readonly filters: ReadonlyArray<Electron.FileFilter>
}

export interface MessageBoxOptions {
  /** The `webContents` that asked: the box is modal to its window. */
  readonly owner: number
  readonly type: "none" | "info" | "error" | "question" | "warning"
  readonly message: string
  readonly detail: string
  /** Left to right as Windows draws them; the first is the default (Enter). */
  readonly buttons: ReadonlyArray<string>
  /** The button Escape (or closing the box) stands for. */
  readonly cancelId: number
}

export class ElectronDialog extends Context.Service<ElectronDialog, {
  /** A blocking native error box; safe to call before `ready`, so fatal startup errors use it. */
  readonly showErrorBox: (title: string, content: string) => Effect.Effect<void>
  /** The native open dialog for one file; none when cancelled. */
  readonly showOpenFile: (options: FileDialogOptions) => Effect.Effect<Option.Option<string>, ElectronDialogError>
  /** The native open dialog for one folder (`filters` are ignored); none when cancelled. */
  readonly showOpenFolder: (options: FileDialogOptions) => Effect.Effect<Option.Option<string>, ElectronDialogError>
  /** A native message box with `buttons`; the index of the one picked. */
  readonly showMessageBox: (options: MessageBoxOptions) => Effect.Effect<number, ElectronDialogError>
  /** The native save dialog (it asks before replacing a file); none when cancelled. */
  readonly showSaveFile: (options: FileDialogOptions) => Effect.Effect<Option.Option<string>, ElectronDialogError>
}>()("ballest/desktop/electron/ElectronDialog") {}
