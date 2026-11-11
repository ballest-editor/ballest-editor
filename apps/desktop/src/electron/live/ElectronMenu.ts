import { Effect, Layer } from "effect"
import * as Electron from "electron"
import { ElectronMenu } from "../ElectronMenu"

export const layerElectronMenu = Layer.succeed(
  ElectronMenu,
  ElectronMenu.of({
    remove: Effect.sync(() => Electron.Menu.setApplicationMenu(null)),
    set: (template) => Effect.sync(() => Electron.Menu.setApplicationMenu(Electron.Menu.buildFromTemplate(template)))
  })
)
