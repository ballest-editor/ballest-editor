// `pnpm map`: the editor's own map code on the command line (tools/map/README.md). `pnpm map --help`.
import { mapFileNameOf } from "@ballest/contracts"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Catalog, type CatalogIndex, indexCatalog } from "../../../apps/web/src/domain/Catalog.ts"
import { diffMaps, mapDiffLabelOf } from "../../../apps/web/src/domain/mapDiff.ts"
import type { MapFile } from "../../../apps/web/src/domain/MapFile.ts"
import { validateMap } from "../../../apps/web/src/domain/validateMap.ts"
import { MapCodec } from "../../../apps/web/src/services/MapCodec.ts"
import { buildablePieces, buildMap, loadedPieces, pieceChanges, summaryOf, VerifiedPieces } from "./maps.ts"

class MapToolError extends Schema.TaggedError<MapToolError>()("MapToolError", {
  message: Schema.String
}) {}

const fail = (message: string) => new MapToolError({ message })

const REPO = new URL("../../../", import.meta.url).pathname
const GAME_INSTALL = "steamapps/common/Ballest of Them All"
const SAMPLE_MAPS = `${REPO}samples/UserSavedMaps`
const DEFAULT_PROJECT = ".dev-project"
const SEED_CREATOR = "Seed"
/** The maps every seeded project has: an everyday one, a busy one and one near what a real big map holds. */
const SEED_MAPS = [
  { name: "Small", items: 20 },
  { name: "Medium", items: 500 },
  { name: "Large", items: 5000 }
] as const

const decodeCatalog = Schema.decodeUnknownEffect(Schema.fromJsonString(Catalog))
const decodeVerified = Schema.decodeUnknownEffect(VerifiedPieces)

const readText = (file: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(file).pipe(Effect.mapError((error) => fail(`${file}: ${error.message}`)))
  })

const loadCatalog = Effect.gen(function*() {
  const text = yield* readText(`${REPO}assets/catalog.json`)
  return yield* decodeCatalog(text).pipe(Effect.mapError((error) => fail(`assets/catalog.json: ${error.message}`)))
})

const loadIndex: Effect.Effect<CatalogIndex, MapToolError, FileSystem.FileSystem> = Effect.map(
  loadCatalog,
  indexCatalog
)

const loadPieces = Effect.gen(function*() {
  const catalog = yield* loadCatalog
  const text = yield* readText(`${REPO}assets/verified.json`)
  const verified = yield* decodeVerified(text).pipe(
    Effect.mapError((error) => fail(`assets/verified.json: ${error.message}`))
  )
  return buildablePieces(catalog.pieces, loadedPieces(verified))
})

const readMap = (file: string) =>
  Effect.gen(function*() {
    const codec = yield* MapCodec
    const text = yield* readText(file)
    const map = yield* codec.decode(text).pipe(Effect.mapError((error) => fail(`${file}: ${error.message}`)))
    return { map, characters: text.length }
  })

/** samples/ are fixtures and the game install is off limits (AGENTS.md), so nothing here writes to either. */
const writable = (target: string) =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const resolved = path.resolve(target)
    const refused = resolved.includes(GAME_INSTALL) || resolved.startsWith(`${REPO}samples`)
    return yield* refused ? Effect.fail(fail(`Won't write to ${resolved}.`)) : Effect.succeed(resolved)
  })

/** Refuses a map the game wouldn't load, then writes it in the game's own layout. */
const writeMap = (file: string, map: MapFile, catalog: CatalogIndex) =>
  Effect.gen(function*() {
    const { errors } = validateMap(map, catalog)
    if (errors.length > 0) return yield* fail(`${file}: ${errors.join(" ")}`)
    const codec = yield* MapCodec
    const fs = yield* FileSystem.FileSystem
    const text = yield* codec.encode(map).pipe(Effect.mapError((error) => fail(error.message)))
    yield* fs.writeFileString(file, text).pipe(Effect.mapError((error) => fail(`${file}: ${error.message}`)))
  })

const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2))
const mapArgument = (name: string) => Argument.String(name).pipe(Argument.withDescription("a .balledit or .ballmap"))
const jsonFlag = Flag.Boolean("json").pipe(Flag.withDescription("print JSON"), Flag.withDefault(false))

const inspect = Command.make(
  "inspect",
  { file: mapArgument("file"), json: jsonFlag },
  ({ file, json }) =>
    Effect.gen(function*() {
      const catalog = yield* loadIndex
      const { characters, map } = yield* readMap(file)
      const summary = summaryOf(map, characters, catalog)
      if (json) return yield* printJson(summary)
      yield* Console.log(`${summary.name} by ${summary.creator} (${summary.difficulty})`)
      yield* Console.log(`${summary.items} items, ${summary.groups} groups, validated: ${summary.validated}`)
      yield* Console.log(`${summary.characters} of ${summary.characterLimit} characters`)
      for (const { count, piece } of summary.topPieces) yield* Console.log(`${String(count).padStart(6)}  ${piece}`)
      if (summary.unknownPieces.length > 0) {
        yield* Console.log(`Not in the catalog: ${summary.unknownPieces.join(", ")}`)
      }
    })
).pipe(Command.withDescription("What a map holds: its name, size and most used pieces"))

const validate = Command.make(
  "validate",
  { files: mapArgument("file").pipe(Argument.atLeast(1)), json: jsonFlag },
  ({ files, json }) =>
    Effect.gen(function*() {
      const catalog = yield* loadIndex
      const results = yield* Effect.forEach(files, (file) =>
        Effect.map(readMap(file), ({ map }) => ({ file, ...validateMap(map, catalog) })))
      if (json) {
        yield* printJson(results)
      } else {
        for (const { errors, file, warnings } of results) {
          yield* Console.log(`${file}: ${errors.length} errors, ${warnings.length} warnings`)
          for (const error of errors) {
            yield* Console.log(`  error: ${error}`)
          }
          for (const warning of warnings) {
            yield* Console.log(`  warning: ${warning}`)
          }
        }
      }
      const failed = results.filter(({ errors }) =>
        errors.length > 0
      ).length
      if (failed > 0) return yield* fail(`${failed} of ${results.length} maps have errors.`)
    })
).pipe(Command.withDescription("The Inspector's Validate on the command line; fails when a map has errors"))

const diff = Command.make(
  "diff",
  { before: mapArgument("before"), after: mapArgument("after"), json: jsonFlag },
  ({ after, before, json }) =>
    Effect.gen(function*() {
      const was = yield* readMap(before)
      const now = yield* readMap(after)
      // Sidecars aren't read, so items pair by class and position (domain/mapDiff.ts).
      const changes = diffMaps({ map: was.map, ids: [] }, { map: now.map, ids: [] })
      const pieces = pieceChanges(was.map, now.map)
      if (json) return yield* printJson({ ...changes, pieces })
      yield* Console.log(mapDiffLabelOf(changes) || "No item changes")
      for (const { count, piece } of pieces) {
        yield* Console.log(`${(count > 0 ? `+${count}` : String(count)).padStart(6)}  ${piece}`)
      }
    })
).pipe(Command.withDescription("The items one map gained, lost and moved against another"))

const itemsFlag = Flag.Int("items").pipe(Flag.withDescription("how many pieces to place"), Flag.withDefault(100))
const seedFlag = Flag.Int("seed").pipe(Flag.withDescription("the same seed builds the same map"), Flag.withDefault(1))

const build = Command.make(
  "build",
  {
    folder: Argument.String("folder").pipe(Argument.withDescription("where to write the map")),
    name: Flag.String("name").pipe(Flag.withDescription("the map's name"), Flag.withDefault("Generated")),
    creator: Flag.String("creator").pipe(Flag.withDescription("its creator"), Flag.withDefault(SEED_CREATOR)),
    items: itemsFlag,
    seed: seedFlag
  },
  ({ creator, folder, items, name, seed }) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const target = yield* writable(folder)
      const pieces = yield* loadPieces
      yield* fs.makeDirectory(target, { recursive: true }).pipe(Effect.mapError((error) => fail(error.message)))
      const file = path.join(target, mapFileNameOf(name, creator))
      yield* writeMap(file, buildMap({ name, creator, items, seed, pieces }), yield* loadIndex)
      yield* Console.log(file)
    })
).pipe(Command.withDescription("Writes a generated map; the same options write the same bytes"))

const seed = Command.make(
  "seed",
  {
    folder: Argument.String("folder").pipe(
      Argument.withDescription("the project folder to make"),
      Argument.withDefault(DEFAULT_PROJECT)
    ),
    samples: Flag.Boolean("samples").pipe(
      Flag.withDescription("copy samples/UserSavedMaps in too"),
      Flag.withDefault(false)
    ),
    force: Flag.Boolean("force").pipe(
      Flag.withDescription("replace the project already there"),
      Flag.withDefault(false)
    )
  },
  ({ folder, force, samples }) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const target = yield* writable(folder)
      const io = (error: { readonly message: string }) => fail(error.message)
      const exists = yield* fs.exists(target).pipe(Effect.mapError(io))
      if (exists && !force) return yield* fail(`${target} exists; pass --force to replace it.`)
      if (exists) yield* fs.remove(target, { recursive: true }).pipe(Effect.mapError(io))
      const maps = path.join(target, "maps")
      yield* fs.makeDirectory(maps, { recursive: true }).pipe(Effect.mapError(io))
      yield* fs.writeFileString(
        path.join(target, "ballest-project.json"),
        `${JSON.stringify({ formatVersion: 1, name: "Seed", exportTarget: "game" }, null, 2)}\n`
      ).pipe(Effect.mapError(io))
      yield* fs.writeFileString(path.join(target, ".gitignore"), ".ballest/\n").pipe(Effect.mapError(io))
      const pieces = yield* loadPieces
      const catalog = yield* loadIndex
      yield* Effect.forEach(SEED_MAPS, ({ items, name }) =>
        writeMap(
          path.join(maps, mapFileNameOf(name, SEED_CREATOR)),
          buildMap({ name, creator: SEED_CREATOR, items, seed: 1, pieces }),
          catalog
        ))
      if (samples) {
        const names = yield* fs.readDirectory(SAMPLE_MAPS).pipe(Effect.mapError(io))
        yield* Effect.forEach(names, (name) =>
          fs.copyFile(path.join(SAMPLE_MAPS, name), path.join(maps, name)).pipe(Effect.mapError(io)))
      }
      yield* Console.log(target)
    })
).pipe(Command.withDescription("Makes a project of generated maps to test with, as copies (never links)"))

Command.make("map").pipe(
  Command.withSubcommands([inspect, validate, diff, build, seed]),
  Command.run({ version: "0.1.0" }),
  Effect.provide(Layer.mergeAll(MapCodec.layer, NodeServices.layer)),
  NodeRuntime.runMain
)
