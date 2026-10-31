import { Context, Effect, type FileSystem, Layer, type Path, Schema, type Scope } from "effect"
import * as Electron from "electron"
import { serveStatic, type StaticSite } from "../protocol/serveStatic"

/** The one host the app is served from: `ballest://app/`. */
const HOST = "app"
const SCHEMES = { production: "ballest", development: "ballest-dev" } as const

export const desktopScheme = (isDevelopment: boolean) => isDevelopment ? SCHEMES.development : SCHEMES.production
export const desktopUrl = (isDevelopment: boolean) => `${desktopScheme(isDevelopment)}://${HOST}/`

/**
 * Gives both schemes the privileges of https (fetch, CORS, streaming, secure context). Electron requires this
 * synchronously before `ready`, so `main.ts` calls it at load, ahead of the Effect runtime.
 */
export const registerSchemePrivileges = () =>
  Electron.protocol.registerSchemesAsPrivileged(
    Object.values(SCHEMES).map((scheme) => ({
      scheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        // Custom schemes opt into V8's code cache; the dev scheme serves code that changes under it.
        codeCache: scheme === SCHEMES.production
      }
    }))
  )

/**
 * The editor loads nothing from the network but its meshes and textures, which are still on Vercel Blob when the
 * build didn't have `web-assets/` (https:). GLTFLoader decodes embedded textures through blob: URLs and the meshopt
 * decoder is WebAssembly. index.html's panel-width script is inline. In development Vite's HMR client talks to its
 * own port over ws:.
 */
const contentSecurityPolicy = (isDevelopment: boolean) =>
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    `connect-src 'self' blob: data: https:${isDevelopment ? " ws:" : ""}`,
    "img-src 'self' blob: data: https:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'"
  ].join("; ")

const withHeaders = (response: Response, policy: string) => {
  const headers = new Headers(response.headers)
  headers.set("content-security-policy", policy)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/** Headers that describe the custom-scheme request and would make Vite treat the proxied one as cross-site. */
const strippedHeader = (name: string) =>
  ["host", "origin", "referer", "connection", "content-length", "accept-encoding"].includes(name)
  || name.startsWith("sec-fetch-")

class ProxyError
  extends Schema.TaggedError<ProxyError>()("ProxyError", { url: Schema.String, cause: Schema.Defect() })
{}

const proxy = Effect.fn("ElectronProtocol.proxy")(function*(request: Request, url: URL, origin: URL) {
  const target = new URL(origin)
  // Assigned, not concatenated, so a path like `//evil.example` can't replace the host.
  target.pathname = url.pathname
  target.search = url.search
  const headers = new Headers([...request.headers].filter(([name]) => !strippedHeader(name)))
  return yield* Effect.tryPromise({
    try: () => Electron.net.fetch(target.href, { method: request.method, headers }),
    catch: (cause) => new ProxyError({ url: target.href, cause })
  })
})

export type DesktopProtocolSource =
  | { readonly _tag: "Static"; readonly site: StaticSite }
  | { readonly _tag: "DevServer"; readonly origin: URL }

export class ElectronProtocolRegistrationError extends Schema.TaggedError<ElectronProtocolRegistrationError>()(
  "ElectronProtocolRegistrationError",
  { scheme: Schema.String, cause: Schema.Defect() }
) {
  override get message(): string {
    return `Failed to handle the ${this.scheme}:// protocol.`
  }
}

export class ElectronProtocol extends Context.Service<ElectronProtocol, {
  /** Serves `ballest(-dev)://app/*` from `source` until the scope closes. */
  readonly register: (
    source: DesktopProtocolSource
  ) => Effect.Effect<void, ElectronProtocolRegistrationError, Scope.Scope>
}>()("ballest/desktop/electron/ElectronProtocol") {
  static readonly layer = Layer.effect(
    ElectronProtocol,
    Effect.gen(function*() {
      const runPromise = Effect.runPromiseWith(yield* Effect.context<FileSystem.FileSystem | Path.Path>())

      const register = (source: DesktopProtocolSource) => {
        const isDevelopment = source._tag === "DevServer"
        const scheme = desktopScheme(isDevelopment)
        const policy = contentSecurityPolicy(isDevelopment)

        const respond = (request: Request) => {
          const url = new URL(request.url)
          if (url.host !== HOST) return Effect.succeed(new Response(null, { status: 404 }))
          return (source._tag === "Static"
            ? serveStatic(request, url.pathname, source.site)
            : proxy(request, url, source.origin).pipe(
              Effect.catchTag(
                "ProxyError",
                (error) =>
                  Effect.logWarning("Dev server request failed", error.url, error.cause).pipe(
                    Effect.as(new Response(null, { status: 502 }))
                  )
              )
            )).pipe(Effect.map((response) => withHeaders(response, policy)))
        }

        return Effect.acquireRelease(
          Effect.try({
            try: () => Electron.protocol.handle(scheme, (request) => runPromise(respond(request))),
            catch: (cause) => new ElectronProtocolRegistrationError({ scheme, cause })
          }),
          () => Effect.sync(() => Electron.protocol.unhandle(scheme))
        )
      }

      return ElectronProtocol.of({ register })
    })
  )
}
