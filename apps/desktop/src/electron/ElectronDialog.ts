import { Context, Effect, Layer, Option, Schema } from "effect"
import * as Electron from "electron"

export class ElectronDialogError extends Schema.TaggedError<ElectronDialogError>()("ElectronDialogError", {
  kind: Schema.Literals(["open", "save"]),
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

const ownerWindow = (id: number): Electron.BrowserWindow | undefined => {
  const contents = Electron.webContents.fromId(id)
  return contents === undefined ? undefined : Electron.BrowserWindow.fromWebContents(contents) ?? undefined
}

const dialogOptions = (options: FileDialogOptions) => ({
  title: options.title,
  filters: [...options.filters],
  ...Option.match(options.defaultPath, { onNone: () => ({}), onSome: (defaultPath) => ({ defaultPath }) })
})

export class ElectronDialog extends Context.Service<ElectronDialog, {
  /** A blocking native error box; safe to call before `ready`, so fatal startup errors use it. */
  readonly showErrorBox: (title: string, content: string) => Effect.Effect<void>
  /** The native open dialog for one file; none when cancelled. */
  readonly showOpenFile: (options: FileDialogOptions) => Effect.Effect<Option.Option<string>, ElectronDialogError>
  /** The native save dialog (it asks before replacing a file); none when cancelled. */
  readonly showSaveFile: (options: FileDialogOptions) => Effect.Effect<Option.Option<string>, ElectronDialogError>
}>()("ballest/desktop/electron/ElectronDialog") {
  static readonly layer = Layer.succeed(
    ElectronDialog,
    ElectronDialog.of({
      showErrorBox: (title, content) => Effect.sync(() => Electron.dialog.showErrorBox(title, content)),
      showOpenFile: (options) =>
        Effect.tryPromise({
          try: () => {
            const owner = ownerWindow(options.owner)
            const opts: Electron.OpenDialogOptions = { ...dialogOptions(options), properties: ["openFile"] }
            return owner === undefined
              ? Electron.dialog.showOpenDialog(opts)
              : Electron.dialog.showOpenDialog(owner, opts)
          },
          catch: (cause) => new ElectronDialogError({ kind: "open", cause })
        }).pipe(Effect.map(({ canceled, filePaths }) => canceled ? Option.none() : Option.fromNullishOr(filePaths[0]))),
      showSaveFile: (options) =>
        Effect.tryPromise({
          try: () => {
            const owner = ownerWindow(options.owner)
            const opts: Electron.SaveDialogOptions = {
              ...dialogOptions(options),
              properties: ["createDirectory", "showOverwriteConfirmation"]
            }
            return owner === undefined
              ? Electron.dialog.showSaveDialog(opts)
              : Electron.dialog.showSaveDialog(owner, opts)
          },
          catch: (cause) => new ElectronDialogError({ kind: "save", cause })
        }).pipe(
          Effect.map(({ canceled, filePath }) =>
            canceled || filePath.length === 0 ? Option.none() : Option.some(filePath)
          )
        )
    })
  )
}
