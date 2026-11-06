/** The syncConflict dialog (docs/DESKTOP.md § Sync): how a map's two versions differ, and asking which to keep. */
import { Effect } from "effect"
import { diffMaps, type MapDiff, withPivotsOf } from "../../domain/mapDiff"
import { MapCodec } from "../../services/MapCodec"
import { Platform } from "../../services/Platform"
import { type SyncConflict, useEditor } from "../store"
import { currentVersionOf, versionOfFile } from "./shared"

/**
 * The project's version of `fileName`, in its tab if open, and the game's with the project's pivots carried across, as
 * Re-import takes it: every save in the game drops them, and the map file is their only home.
 */
const versionsOf = Effect.fnUntraced(function*(fileName: string) {
  const game = yield* (yield* Platform).readExport(fileName).pipe(Effect.flatMap(versionOfFile))
  const current = yield* currentVersionOf(fileName)
  return { current, game, kept: current === null ? game : withPivotsOf(current, game) }
})

/** How the game's version of `fileName` differs from the project's; null when one won't read. */
export const gameDiffOf = (fileName: string): Effect.Effect<MapDiff | null, never, Platform | MapCodec> =>
  versionsOf(fileName).pipe(
    Effect.map(({ current, kept }) => current === null ? null : diffMaps(current, kept)),
    Effect.orElseSucceed(() => null)
  )

/** What Re-import takes in place of the game's bytes: them with the project's pivots, when it has any to carry. */
export const textKeepingPivots = (fileName: string): Effect.Effect<string | undefined, never, Platform | MapCodec> =>
  Effect.gen(function*() {
    const { game, kept } = yield* versionsOf(fileName)
    return kept === game ? undefined : yield* MapCodec.use((codec) => codec.encode(kept.map))
  }).pipe(Effect.orElseSucceed(() => undefined))

/** Opens the dialog about `fileName`. */
export const askSyncConflict = (fileName: string, from: SyncConflict["from"], replacePublished: boolean) =>
  Effect.gen(function*() {
    const diff = yield* gameDiffOf(fileName)
    useEditor.getState().openDialog({ id: "syncConflict", name: fileName, from, replacePublished, diff })
  })
