import { GameWriteProgress, PushChannels } from "@ballest/contracts"
import { Effect, Schema } from "effect"
import type { ElectronWindow } from "../electron/ElectronWindow"

const encodeProgress = Schema.encodeEffect(GameWriteProgress)

/** Tells the pages how far an Export or a Play has got, for the status bar's chip (docs/DESKTOP.md § Status bar). */
export const reportGameWriteProgress = (windows: ElectronWindow["Service"], progress: GameWriteProgress) =>
  encodeProgress(progress).pipe(
    Effect.flatMap((encoded) => windows.sendAll(PushChannels.onGameWriteProgress, encoded)),
    Effect.orDie
  )
