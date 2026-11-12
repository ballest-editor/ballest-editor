import type { SiteUploadResult } from "@ballest/contracts"
import { Effect, Option } from "effect"
import { Prefabs } from "../../project/Prefabs"
import { SiteAccount } from "../../site/SiteAccount"
import { SiteClient, type SiteError } from "../../site/SiteClient"
import type { DesktopIpcHandlers } from "../DesktopIpc"

const fieldOf = (body: unknown, key: string): unknown =>
  typeof body === "object" && body !== null && key in body ? Reflect.get(body, key) : undefined

const stringField = (body: unknown, key: string): string | null => {
  const value = fieldOf(body, key)
  return typeof value === "string" ? value : null
}

/** What the site's refusal of an upload means (its `POST /api/prefabs`). */
const uploadRefusalOf = (error: SiteError): SiteUploadResult => {
  const { body, status } = error
  if (status === 401) return { _tag: "SignedOut" }
  if (status === 429) return { _tag: "Limited", nextAt: stringField(body, "nextAt") }
  const problems = fieldOf(body, "problems")
  if (status === 400 && Array.isArray(problems)) {
    return { _tag: "Refused", problems: problems.filter((p): p is string => typeof p === "string").slice(0, 20) }
  }
  if (status === 403) return { _tag: "Refused", problems: ["ballestrecords.com won't take uploads from this account."] }
  return { _tag: "Failed", message: error.message }
}

export const siteHandlers = {
  listSitePrefabs: Effect.fn("ipc.listSitePrefabs")(function*(payload) {
    return yield* (yield* SiteClient).list(payload)
  }),
  readSitePrefabThumb: Effect.fn("ipc.readSitePrefabThumb")(function*({ slug }) {
    return Option.getOrNull(yield* (yield* SiteClient).thumb(slug))
  }),
  readSitePrefab: Effect.fn("ipc.readSitePrefab")(function*({ slug }) {
    return { text: yield* (yield* SiteClient).file(slug) }
  }),
  siteAccount: Effect.fn("ipc.siteAccount")(function*() {
    return yield* (yield* SiteAccount).state
  }),
  signInToSite: Effect.fn("ipc.signInToSite")(function*() {
    return yield* (yield* SiteAccount).signIn
  }),
  signOutOfSite: Effect.fn("ipc.signOutOfSite")(function*() {
    yield* (yield* SiteAccount).signOut
  }),
  /** Reads the prefab's file itself, so only a tier's own prefab goes up, and a refused token is forgotten. */
  uploadPrefab: Effect.fn("ipc.uploadPrefab")(function*({ fields, prefab, view }) {
    const account = yield* SiteAccount
    const token = yield* account.token
    if (Option.isNone(token)) return { _tag: "SignedOut" } satisfies SiteUploadResult
    const { text } = yield* (yield* Prefabs).read(prefab)
    const site = yield* SiteClient
    return yield* site.upload(token.value, fields, text, view).pipe(
      Effect.map((slug): SiteUploadResult => ({
        _tag: "Uploaded",
        slug,
        url: new URL(`/prefab/${slug}`, site.base).href
      })),
      Effect.catchTag("SiteError", (error) => {
        const result = uploadRefusalOf(error)
        return (result._tag === "SignedOut" ? account.signOut : Effect.void).pipe(Effect.as(result))
      })
    )
  })
} satisfies Partial<DesktopIpcHandlers>
