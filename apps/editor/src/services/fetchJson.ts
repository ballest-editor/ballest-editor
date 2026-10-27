/**
 * The one fetch -> text -> JSON pipeline for the served asset files (catalog, materials,
 * keybinds, verification table). Failures are the caller's typed error, built by `fail`.
 */
import { Effect } from "effect"

export type FetchText = (url: string) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>

export const browserFetch: FetchText = (url) => globalThis.fetch(url)

/** For tests: serve `body` (or a 404 when undefined) instead of fetching. */
export const fetchFromText = (body: string | undefined): FetchText => () =>
  Promise.resolve({ ok: body !== undefined, status: body === undefined ? 404 : 200, text: () => Promise.resolve(body ?? "") })

export const fetchJson = <E>(fetchText: FetchText, url: string, fail: (message: string) => E): Effect.Effect<unknown, E> =>
  Effect.gen(function*() {
    const response = yield* Effect.tryPromise({ try: () => fetchText(url), catch: (cause) => fail(`request failed: ${String(cause)}`) })
    if (!response.ok) return yield* Effect.fail(fail(`HTTP ${response.status}`))
    const text = yield* Effect.tryPromise({ try: () => response.text(), catch: (cause) => fail(String(cause)) })
    return yield* Effect.try({
      // Dev servers answer unknown paths with the HTML shell, so a non-JSON body means "missing".
      try: () => JSON.parse(text) as unknown,
      catch: () => fail(`response is not JSON (${url.slice(url.lastIndexOf("/") + 1)} missing?)`)
    })
  })
