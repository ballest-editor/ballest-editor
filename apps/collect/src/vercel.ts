import { type Effect, type Layer, ManagedRuntime } from "effect"
import type { IncomingMessage, ServerResponse } from "node:http"

/**
 * A function's handler: a web `Request` in, a `Response` out, failures already turned into responses. Shared with
 * apps/admin (`@ballest/collect/vercel`).
 */
export type Handler<R> = (request: Request) => Effect.Effect<Response, never, R>

const readBody = async (req: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | undefined> => {
  if (req.method === "GET" || req.method === "HEAD") return undefined
  const chunks: Array<Uint8Array> = []
  for await (const chunk of req) chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk)))
  return new Uint8Array(Buffer.concat(chunks))
}

/** The Node request Vercel's Nodejs launcher passes in, as a web `Request`. */
export const toRequest = async (req: IncomingMessage): Promise<Request> => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, one)
  }
  const url = new URL(req.url ?? "/", `https://${req.headers.host ?? "localhost"}`)
  const body = await readBody(req)
  return new Request(url, { method: req.method ?? "GET", headers, ...(body === undefined ? {} : { body }) })
}

const write = async (response: Response, res: ServerResponse) => {
  res.statusCode = response.status
  response.headers.forEach((value, name) => res.setHeader(name, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}

/**
 * The function's default export: runs `handler` in a runtime built once per instance from `layer`, so services (a
 * cached GitHub token) outlive one request. A layer that can't be built (a missing env var) answers 500 and is logged.
 */
export const serve = <R, E>(layer: Layer.Layer<R, E>, handler: Handler<R>) => {
  const runtime = ManagedRuntime.make(layer)
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const response = await toRequest(req)
      .then((request) => runtime.runPromise(handler(request)))
      .catch((cause: unknown) => {
        console.error(cause)
        return Response.json({ error: "internal error" }, { status: 500 })
      })
    await write(response, res)
  }
}
