import { describe, expect, it, vi } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { createServer } from "node:http"
import { serve } from "./vercel"

/** Runs `listener` on a local port for one request, the way Vercel's Nodejs launcher calls the default export. */
const once = async (listener: ReturnType<typeof serve>, init: RequestInit) => {
  const server = createServer((req, res) => void listener(req, res))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const address = server.address()
    if (address === null || typeof address === "string") throw new Error("no port")
    return await fetch(`http://127.0.0.1:${address.port}/api/echo?x=1`, init)
  } finally {
    server.close()
  }
}

describe("serve", () => {
  it("hands the handler a web Request and writes its Response", async () => {
    const listener = serve(Layer.empty, (request) =>
      Effect.promise(async () =>
        Response.json(
          { method: request.method, path: new URL(request.url).pathname, body: await request.text() },
          { status: 201, headers: { "x-seen": request.headers.get("x-forwarded-for") ?? "" } }
        )
      ))
    const response = await once(listener, { method: "POST", body: "hello", headers: { "x-forwarded-for": "1.2.3.4" } })
    expect(response.status).toBe(201)
    expect(response.headers.get("x-seen")).toBe("1.2.3.4")
    expect(await response.json()).toEqual({ method: "POST", path: "/api/echo", body: "hello" })
  })

  it("answers 500 when the services can't be built", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const listener = serve(Layer.effectDiscard(Effect.die("no DATABASE_URL")), () => Effect.succeed(new Response()))
    const response = await once(listener, { method: "GET" })
    expect(response.status).toBe(500)
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})
