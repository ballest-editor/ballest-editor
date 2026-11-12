/**
 * ballestrecords.com's prefabs in the Prefabs panel (docs/DESKTOP.md § Prefabs): browsing the site's gallery, taking one
 * into a tier to place or keep, and the sign-in that lets a tier's prefab go up to the site. Main does the requests and
 * keeps the token; the page only sees what they answered.
 */
import type { PrefabRef, PrefabTier, SitePrefab, SitePrefabPage, SiteUploadFields } from "@ballest/contracts"
import { Effect } from "effect"
import { freePrefabName } from "../../domain/prefab"
import { Platform } from "../../services/Platform"
import { type EditorState, inNamedProject, useEditor } from "../store"
import { checkPrefabs, placePrefabEffect } from "./prefabs"
import { run } from "./run"

/** Whether the player is signed in, into the store (desktop). */
export const loadSiteAccountEffect = Effect.gen(function*() {
  const platform = yield* Platform
  if (!platform.capabilities.site) return
  useEditor.getState().setSiteAccount(yield* platform.siteAccount)
})

/**
 * One page of the site's gallery, most favourited first: the first with `cursor` null, then the page's `next`. Null when
 * the site can't be reached, which the section says itself rather than in a notification on every search.
 */
export const listSitePrefabs = async (query: string, cursor: number | null): Promise<SitePrefabPage | null> =>
  await run(
    Effect.flatMap(Effect.service(Platform), (platform) => platform.listSitePrefabs(query, cursor)).pipe(
      Effect.catch((error) => Effect.as(Effect.logWarning("Couldn't list ballestrecords.com's prefabs", error), null))
    )
  ) ?? null

/** A site prefab's thumbnail as a data URL; null when it has none or it won't load, which needs no saying. */
export const readSitePrefabThumb = async (slug: string): Promise<string | null> =>
  await run(
    Effect.flatMap(Effect.service(Platform), (platform) => platform.readSitePrefabThumb(slug)).pipe(
      Effect.orElseSucceed(() => null)
    )
  ) ?? null

/** Where a site prefab goes when it is placed: the project's tier, or the game's in Untitled Project and a browser. */
export const siteTierOf = (s: Pick<EditorState, "capabilities" | "project">): PrefabTier =>
  s.capabilities.projects && inNamedProject(s) ? "project" : "user"

/**
 * The site prefab's file written into `tier`, under its name made a prefab name, numbered clear of the tier's. When the
 * tier already has it under that name, byte for byte, that one is used: placing it twice doesn't make two copies.
 */
export const takeSitePrefabEffect = Effect.fn("takeSitePrefabEffect")(function*(prefab: SitePrefab, tier: PrefabTier) {
  const platform = yield* Platform
  const text = yield* platform.readSitePrefab(prefab.slug)
  const names = new Set(useEditor.getState().prefabs.filter((p) => p.tier === tier).map((p) => p.name))
  const own = freePrefabName(prefab.name, new Set())
  if (names.has(own)) {
    const there = yield* platform.readPrefab({ tier, name: own }).pipe(Effect.option)
    if (there._tag === "Some" && there.value.text === text) return { tier, name: own } satisfies PrefabRef
  }
  const ref: PrefabRef = { tier, name: freePrefabName(prefab.name, names) }
  yield* platform.writePrefab({ ...ref, text, replace: false })
  yield* checkPrefabs
  return ref
})

/** A click on a site prefab: taken into `siteTierOf`'s tier, then placed as any prefab of it is. */
export const placeSitePrefabEffect = Effect.fn("placeSitePrefabEffect")(function*(prefab: SitePrefab) {
  const ref = yield* takeSitePrefabEffect(prefab, siteTierOf(useEditor.getState()))
  yield* placePrefabEffect(ref)
})

export const placeSitePrefab = (prefab: SitePrefab) => run(placeSitePrefabEffect(prefab))

/** Copy to project, Copy to game on a site prefab: kept in that tier without placing it. */
export const copySitePrefab = (prefab: SitePrefab, tier: PrefabTier) =>
  run(
    takeSitePrefabEffect(prefab, tier).pipe(
      Effect.tap((ref) =>
        Effect.sync(() => useEditor.getState().notify("info", `Saved the prefab ${ref.name}`, { kind: "prefabSaved" }))
      )
    )
  )

/** Sign in: the site opens in the browser, and the app hears back when the player has said yes or no. */
export const signInToSiteEffect = Effect.gen(function*() {
  const result = yield* (yield* Platform).signInToSite
  const { notify, setSiteAccount } = useEditor.getState()
  switch (result._tag) {
    case "SignedIn":
      setSiteAccount(result)
      notify("info", "Signed in to ballestrecords.com", { kind: "siteSignedIn" })
      return
    case "Cancelled":
      return
    case "Failed":
      notify("error", "Couldn't sign in to ballestrecords.com", { kind: "siteSignInFailed", body: result.message })
  }
})

export const signInToSite = () => run(signInToSiteEffect)

export const signOutOfSiteEffect = Effect.gen(function*() {
  yield* (yield* Platform).signOutOfSite
  useEditor.getState().setSiteAccount({ _tag: "SignedOut" })
})

export const signOutOfSite = () => run(signOutOfSiteEffect)

/** Opens Upload to ballestrecords.com… for `prefab`. */
export const startUploadPrefab = (prefab: PrefabRef) => useEditor.getState().openDialog({ id: "uploadPrefab", prefab })

/**
 * The upload dialog's Upload: the tier's prefab goes up under `fields`. True once it is on the site (its toast links to
 * its page); false with a notification saying why not, and a refused token signs the player out.
 */
export const uploadPrefabEffect = (prefab: PrefabRef, fields: SiteUploadFields) =>
  Effect.gen(function*() {
    const result = yield* (yield* Platform).uploadPrefab({ prefab, fields })
    const { notify, setSiteAccount } = useEditor.getState()
    switch (result._tag) {
      case "Uploaded":
        notify("info", `${fields.name} is on ballestrecords.com`, {
          kind: "prefabUploaded",
          actions: [{ label: "View it", command: { _tag: "OpenExternal", url: result.url } }]
        })
        return true
      case "SignedOut":
        setSiteAccount({ _tag: "SignedOut" })
        notify("error", "Sign in to ballestrecords.com to upload", { kind: "prefabUploadRefused" })
        return false
      case "Limited":
        notify("error", "That's all the uploads ballestrecords.com takes for now", {
          kind: "prefabUploadRefused",
          body: result.nextAt === null
            ? "Try again later."
            : `Try again after ${new Date(result.nextAt).toLocaleTimeString([], { timeStyle: "short" })}.`
        })
        return false
      case "Refused":
        notify("error", "ballestrecords.com didn't take the prefab", {
          kind: "prefabUploadRefused",
          body: result.problems.join(" ")
        })
        return false
      case "Failed":
        notify("error", "Couldn't upload the prefab", { kind: "prefabUploadRefused", body: result.message })
        return false
    }
  })

export const uploadPrefab = async (prefab: PrefabRef, fields: SiteUploadFields) =>
  await run(uploadPrefabEffect(prefab, fields)) ?? false
