import { Effect, Layer, Option } from "effect"
import * as Electron from "electron"
import { ElectronDialog, ElectronDialogError, type FileDialogOptions } from "../ElectronDialog"

const ownerWindow = (id: number): Electron.BrowserWindow | undefined => {
  const contents = Electron.webContents.fromId(id)
  return contents === undefined ? undefined : Electron.BrowserWindow.fromWebContents(contents) ?? undefined
}

const dialogOptions = (options: FileDialogOptions) => ({
  title: options.title,
  filters: [...options.filters],
  ...Option.match(options.defaultPath, { onNone: () => ({}), onSome: (defaultPath) => ({ defaultPath }) })
})

const showOpen = (kind: "open" | "folder", opts: Electron.OpenDialogOptions, ownerId: number) =>
  Effect.tryPromise({
    try: () => {
      const owner = ownerWindow(ownerId)
      return owner === undefined ? Electron.dialog.showOpenDialog(opts) : Electron.dialog.showOpenDialog(owner, opts)
    },
    catch: (cause) => new ElectronDialogError({ kind, cause })
  }).pipe(Effect.map(({ canceled, filePaths }) => canceled ? Option.none() : Option.fromNullishOr(filePaths[0])))

export const layerElectronDialog = Layer.succeed(
  ElectronDialog,
  ElectronDialog.of({
    showErrorBox: (title, content) => Effect.sync(() => Electron.dialog.showErrorBox(title, content)),
    showOpenFile: (options) => showOpen("open", { ...dialogOptions(options), properties: ["openFile"] }, options.owner),
    showOpenFolder: (options) =>
      showOpen(
        "folder",
        { ...dialogOptions({ ...options, filters: [] }), properties: ["openDirectory"] },
        options.owner
      ),
    showMessageBox: ({ owner: ownerId, buttons, ...options }) =>
      Effect.tryPromise({
        try: () => {
          const owner = ownerWindow(ownerId)
          // `noLink`: Windows would otherwise turn the buttons into command links.
          const opts: Electron.MessageBoxOptions = { ...options, buttons: [...buttons], defaultId: 0, noLink: true }
          return owner === undefined
            ? Electron.dialog.showMessageBox(opts)
            : Electron.dialog.showMessageBox(owner, opts)
        },
        catch: (cause) => new ElectronDialogError({ kind: "message", cause })
      }).pipe(Effect.map(({ response }) => response)),
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
