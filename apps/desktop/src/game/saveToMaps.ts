import type { SaveToGamePayload, SaveToGameResult } from "@ballest/contracts"
import { Effect, FileSystem, Option, Path, Schema } from "effect"
import { MapFiles } from "../files/MapFiles"
import { GamePaths } from "./GamePaths"

export class SaveToGameError extends Schema.TaggedError<SaveToGameError>()("SaveToGameError", {
  fileName: Schema.String
}) {
  override get message(): string {
    return `${this.fileName} isn't a map file name (a .balledit name, no folders).`
  }
}

/** A file name for the maps folder: a `.balledit` name with nothing that could leave the folder or upset Windows. */
export const isMapFileName = (name: string): boolean =>
  name.toLowerCase().endsWith(".balledit") && name.length > ".balledit".length &&
  // oxlint-disable-next-line eslint/no-control-regex -- control characters are exactly what is refused here
  !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !name.startsWith(".") && !name.endsWith(" ")

/** Only the field `saveToMaps` looks at; everything else in the file is ignored. */
const PublishedId = Schema.fromJsonString(Schema.Struct({
  worldSettings: Schema.Struct({ levelData: Schema.Struct({ levelPublishedFileId: Schema.Finite }) })
}))

/**
 * Writes a map into the game's maps folder, where the in-game editor lists it. An existing file that is the draft of a
 * published map (`levelPublishedFileId` > 0) is left alone unless `replacePublished`: overwriting it would cut the
 * draft off from its Workshop item.
 */
export const saveToMaps = Effect.fn("saveToMaps")(function*({ name, text, replacePublished }: SaveToGamePayload) {
  if (!isMapFileName(name)) return yield* new SaveToGameError({ fileName: name })
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const files = yield* MapFiles
  const target = path.join(yield* (yield* GamePaths).mapsFolderForWrite, name)

  if (!replacePublished) {
    const publishedFileId = yield* fs.readFileString(target).pipe(
      Effect.flatMap(Schema.decodeEffect(PublishedId)),
      Effect.map((file) => file.worldSettings.levelData.levelPublishedFileId),
      Effect.option
    )
    if (Option.isSome(publishedFileId) && publishedFileId.value > 0) {
      return { _tag: "Published", file: { path: target, name }, publishedFileId: publishedFileId.value } as const
    }
  }

  yield* files.grant(target)
  const file = yield* files.write(target, text)
  return { _tag: "Saved", file } satisfies SaveToGameResult
})
