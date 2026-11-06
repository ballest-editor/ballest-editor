/**
 * The Project panel's map thumbnails (docs/DESKTOP.md § Project panel): rendered after a Save and kept by main under
 * the hash of the file, so a row shows one only for the bytes it was rendered from. A thumbnail is a nicety, so a
 * failure is logged and the row keeps its glyph.
 */
import { Effect } from "effect"
import { Platform } from "../../services/Platform"
import { mapThumbnailFor } from "../mapThumbnails"
import { type Doc, useEditor } from "../store"
import { runUntilCleanup } from "./run"

/** Renders `doc`, just saved to the file with this hash, and keeps it. Saving the same bytes again renders nothing. */
export const cacheMapThumbnail = (doc: Doc, hash: string) =>
  Effect.gen(function*() {
    const { catalogIndex, mapThumbnails, materialTable, surfaces } = useEditor.getState()
    if (mapThumbnails.has(hash)) return
    const png = yield* Effect.promise(() => mapThumbnailFor(hash, doc.map.items, catalogIndex, materialTable, surfaces))
    if (png === undefined) return
    useEditor.getState().setMapThumbnail(hash, png)
    yield* (yield* Platform).writeMapThumbnail({ hash, png })
  }).pipe(Effect.catch((error) => Effect.logWarning("Couldn't keep a map's thumbnail.", error)))

/** Reads the thumbnail kept for this hash into the store, unless a render got there first; for a React effect. */
export const loadMapThumbnail = (hash: string) =>
  runUntilCleanup(
    Effect.gen(function*() {
      const png = yield* (yield* Platform).readMapThumbnail(hash)
      if (png !== null && !useEditor.getState().mapThumbnails.has(hash)) useEditor.getState().setMapThumbnail(hash, png)
    }),
    "Couldn't read a map's thumbnail."
  )
