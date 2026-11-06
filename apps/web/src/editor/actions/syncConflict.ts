/** The syncConflict dialog (docs/DESKTOP.md § Sync): how a map's two versions differ, and asking which to keep. */
import { Effect } from "effect"
import { diffMaps, type MapDiff } from "../../domain/mapDiff"
import type { MapCodec } from "../../services/MapCodec"
import { Platform } from "../../services/Platform"
import { type SyncConflict, useEditor } from "../store"
import { currentVersionOf, versionOfFile } from "./shared"

/** How the game's version of `fileName` differs from the project's, in its tab if open; null when one won't read. */
export const gameDiffOf = (fileName: string): Effect.Effect<MapDiff | null, never, Platform | MapCodec> =>
  Effect.gen(function*() {
    const game = yield* (yield* Platform).readExport(fileName).pipe(Effect.flatMap(versionOfFile))
    const current = yield* currentVersionOf(fileName)
    return current === null ? null : diffMaps(current, game)
  }).pipe(Effect.orElseSucceed(() => null))

/** Opens the dialog about `fileName`. */
export const askSyncConflict = (fileName: string, from: SyncConflict["from"], replacePublished: boolean) =>
  Effect.gen(function*() {
    const diff = yield* gameDiffOf(fileName)
    useEditor.getState().openDialog({ id: "syncConflict", name: fileName, from, replacePublished, diff })
  })
