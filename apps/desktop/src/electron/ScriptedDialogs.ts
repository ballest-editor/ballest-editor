import { Effect, Layer, Option, Schema } from "effect"
import * as fs from "node:fs"
import { ElectronDialog } from "./ElectronDialog"

/**
 * Native dialogs for the app driver (tools/app-driver), which can't reach them over the DevTools protocol: each dialog
 * takes the next answer from a JSON array in the file `BALLEST_APP_DRIVER_DIALOGS` names, or is cancelled when there is
 * none. `main.ts` uses this only in an unpackaged app with that variable set.
 */
const Answer = Schema.Struct({
  /** A file or folder dialog's path; null cancels it. */
  path: Schema.optional(Schema.NullOr(Schema.String)),
  /** A message box's button, by index. */
  button: Schema.optional(Schema.Finite)
})
const Answers = Schema.fromJsonString(Schema.Array(Answer))

export const nextAnswer = (file: string): typeof Answer.Type => {
  const queue = fs.existsSync(file) ? Schema.decodeSync(Answers)(fs.readFileSync(file, "utf8")) : []
  const [next = {}, ...rest] = queue
  fs.writeFileSync(file, JSON.stringify(rest))
  return next
}

export const layerScriptedDialogs = (file: string) => {
  const path = Effect.sync(() => Option.fromNullishOr(nextAnswer(file).path))
  return Layer.succeed(
    ElectronDialog,
    ElectronDialog.of({
      showErrorBox: (title, content) => Effect.sync(() => console.error(`${title}: ${content}`)),
      showOpenFile: () => path,
      showOpenFolder: () => path,
      showSaveFile: () => path,
      showMessageBox: ({ buttons }) => Effect.sync(() => nextAnswer(file).button ?? buttons.length - 1)
    })
  )
}
