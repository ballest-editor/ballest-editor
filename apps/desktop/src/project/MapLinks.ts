import { MapLink } from "@ballest/contracts"
import { Context, Effect, FileSystem, Layer, Path, Schema, Semaphore } from "effect"
import { writeJson } from "./files"

/** `<project>/.ballest/link.json`: each map's link record, by its file name in `maps/` (docs/PROJECTS.md). */
export const LinkFile = Schema.Struct({
  formatVersion: Schema.Literal(1),
  maps: Schema.Record(Schema.String, MapLink)
})
export type LinkFile = typeof LinkFile.Type

type Links = LinkFile["maps"]

export const linkFilePath = (path: Path.Path, project: string) => path.join(project, ".ballest", "link.json")

export class MapLinkError extends Schema.TaggedError<MapLinkError>()("MapLinkError", {
  path: Schema.String,
  cause: Schema.Defect()
}) {
  override get message(): string {
    return `Couldn't write the map links in ${this.path}.`
  }
}

/** A map with no link yet. */
export const emptyLink: MapLink = { origin: null, export: null, lastSeenHash: null }

/**
 * The link records of a project's maps: where each came from and where and what it was last exported as. Machine
 * specific, so they live in `.ballest/` (gitignored), apart from the maps. Updates run one at a time and write
 * atomically.
 */
export class MapLinks extends Context.Service<MapLinks, {
  /** Every map's link in `project`; empty when the file is missing, or doesn't decode (it is logged). */
  readonly all: (project: string) => Effect.Effect<Links>
  /** Replaces the link of `fileName` with `f` of the current one (null: none yet); returning null drops it. */
  readonly modify: (
    project: string,
    fileName: string,
    f: (link: MapLink | null) => MapLink | null
  ) => Effect.Effect<MapLink | null, MapLinkError>
  /** Moves the link of `from` to `to`, after a rename. */
  readonly rename: (project: string, from: string, to: string) => Effect.Effect<void, MapLinkError>
}>()("ballest/desktop/project/MapLinks") {
  static readonly make = Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const lock = yield* Semaphore.make(1)
    const decode = Schema.decodeEffect(Schema.fromJsonString(LinkFile))
    const encode = Schema.encodeEffect(LinkFile)

    const all = (project: string) => {
      const file = linkFilePath(path, project)
      return fs.readFileString(file).pipe(
        Effect.flatMap(decode),
        Effect.map((links) => links.maps),
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed({})
              : Effect.logWarning(`Couldn't read ${file}`, error).pipe(Effect.as({})),
          SchemaError: (error) => Effect.logWarning(`Ignoring an invalid ${file}`, error.message).pipe(Effect.as({}))
        })
      )
    }

    const update = (project: string, f: (links: Links) => Links) => {
      const file = linkFilePath(path, project)
      return Effect.gen(function*() {
        const next = f(yield* all(project))
        const encoded = yield* encode({ formatVersion: 1, maps: next })
        yield* fs.makeDirectory(path.dirname(file), { recursive: true })
        yield* writeJson(fs, file, encoded)
        return next
      }).pipe(
        Effect.mapError((cause) => new MapLinkError({ path: file, cause })),
        lock.withPermits(1)
      )
    }

    const modify = Effect.fn("MapLinks.modify")(
      function*(project: string, fileName: string, f: (link: MapLink | null) => MapLink | null) {
        const next = yield* update(project, (links) => {
          const { [fileName]: current, ...others } = links
          const link = f(current ?? null)
          return link === null ? others : { ...others, [fileName]: link }
        })
        return next[fileName] ?? null
      }
    )

    const rename = Effect.fn("MapLinks.rename")(function*(project: string, from: string, to: string) {
      yield* update(project, (links) => {
        const { [from]: moved, ...others } = links
        return moved === undefined ? others : { ...others, [to]: moved }
      })
    })

    return MapLinks.of({ all, modify, rename })
  })

  static readonly layer = Layer.effect(MapLinks, MapLinks.make)
}
