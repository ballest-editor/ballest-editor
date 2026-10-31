import { Effect, FileSystem, Option, Path } from "effect"
import * as Mime from "effect/http/Mime"

/** A directory served at a URL path prefix (`/` or `/assets/`). */
export interface StaticMount {
  readonly prefix: string
  readonly directory: string
}

export interface StaticSite {
  /** Tried in order; the first mount with the file wins. */
  readonly mounts: ReadonlyArray<StaticMount>
  /** Served for page navigations that match no file, so client routes resolve to the app. */
  readonly fallback: string
}

const status = (code: number) => new Response(null, { status: code })

/**
 * Answers a GET or HEAD for `pathname` from the site's directories. Paths are decoded once, must stay inside the
 * mount they resolve under (no `..` or absolute escapes), and get a MIME type by extension.
 */
export const serveStatic = Effect.fn("serveStatic")(function*(request: Request, pathname: string, site: StaticSite) {
  if (request.method !== "GET" && request.method !== "HEAD") return status(405)
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const decoded = yield* Effect.try(() => decodeURIComponent(pathname)).pipe(Effect.option)
  if (Option.isNone(decoded) || decoded.value.includes("\0")) return status(400)

  const isFile = (file: string) =>
    fs.stat(file).pipe(Effect.map((info) => info.type === "File"), Effect.orElseSucceed(() => false))

  const candidates = site.mounts.flatMap(({ prefix, directory }) => {
    if (!decoded.value.startsWith(prefix)) return []
    const root = path.resolve(directory)
    const file = path.resolve(root, `.${decoded.value.slice(prefix.length - 1)}`)
    return file.startsWith(root + path.sep) ? [file] : []
  })
  const found = yield* Effect.findFirst(candidates, isFile)
  const wantsPage = path.extname(decoded.value) === "" || request.headers.get("accept")?.includes("text/html") === true
  if (Option.isNone(found) && !wantsPage) return status(404)
  const file = Option.getOrElse(found, () => site.fallback)

  const contents = yield* fs.readFile(file).pipe(Effect.option)
  if (Option.isNone(contents)) return status(404)
  return new Response(request.method === "HEAD" ? null : new Uint8Array(contents.value), {
    headers: {
      "content-type": Option.getOrElse(Mime.getType(file), () => "application/octet-stream"),
      "content-length": String(contents.value.byteLength)
    }
  })
})
