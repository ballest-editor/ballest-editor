import type { FoundCreator } from "@ballest/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path } from "effect"
import { GamePaths } from "./GamePaths"
import { SteamLibrary } from "./SteamLibrary"
import { personaNameOf } from "./vdf"

/** The game's map file name, `Map_LevelEditorMain&<name>_<creator>.balledit`; names have no `_` in them. */
const MAP_FILE_NAME = /^[^&]+&.*_([^_]+)\.balledit$/i

/** Steam's persona names are at most 32 characters; anything longer isn't one. */
const MAX_NAME_LENGTH = 256

/**
 * The creator most of `fileNames` (the maps folder's entries) name, or none when no map file is there. A tie goes to
 * the creator whose first file sorts first, so the answer doesn't depend on the order the folder lists them.
 */
export const mostCommonCreator = (fileNames: ReadonlyArray<string>): Option.Option<string> => {
  const counts = new Map<string, number>()
  for (const name of [...fileNames].sort()) {
    const creator = name.match(MAP_FILE_NAME)?.[1]
    if (creator !== undefined) counts.set(creator, (counts.get(creator) ?? 0) + 1)
  }
  let best: readonly [string, number] | undefined
  for (const entry of counts) if (best === undefined || entry[1] > best[1]) best = entry
  return Option.fromUndefinedOr(best?.[0])
}

const usable = (name: string) => name.length > 0 && name.length <= MAX_NAME_LENGTH

/**
 * The creator name the game writes into every map and its file name: the Steam persona name of the account last
 * logged in (`<steam>/config/loginusers.vdf`, in each of Steam's own folders), else the creator most maps in the maps
 * folder name. Looked up on every call: the user may log in as someone else while the app runs.
 */
export class GameCreator extends Context.Service<GameCreator, {
  readonly find: Effect.Effect<Option.Option<FoundCreator>>
}>()("ballest/desktop/game/GameCreator") {
  static readonly make = Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const steam = yield* SteamLibrary
    const paths = yield* GamePaths

    const fromSteam = Effect.gen(function*() {
      for (const root of yield* steam.roots) {
        const text = yield* fs.readFileString(path.join(root, "config", "loginusers.vdf")).pipe(Effect.option)
        const name = Option.filter(Option.flatMap(text, personaNameOf), usable)
        if (Option.isSome(name)) return name
      }
      return Option.none<string>()
    })

    const fromMapsFolder = Effect.gen(function*() {
      const { mapsFolder } = yield* paths.get
      if (mapsFolder.status === "missing" || mapsFolder.path === null) return Option.none<string>()
      const entries = yield* fs.readDirectory(mapsFolder.path).pipe(Effect.orElseSucceed(() => []))
      return Option.filter(mostCommonCreator(entries), usable)
    })

    const find = Effect.gen(function*() {
      const persona = yield* fromSteam
      if (Option.isSome(persona)) return Option.some<FoundCreator>({ name: persona.value, source: "steam" })
      return Option.map(yield* fromMapsFolder, (name): FoundCreator => ({ name, source: "mapsFolder" }))
    }).pipe(Effect.withSpan("GameCreator.find"))

    return GameCreator.of({ find })
  })

  static readonly layer = Layer.effect(GameCreator, GameCreator.make)
}
