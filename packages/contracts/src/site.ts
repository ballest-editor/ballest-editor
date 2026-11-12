import { Schema } from "effect"

// ballestrecords.com's Prefab gallery (docs/DESKTOP.md § Prefabs › ballestrecords.com), as main reaches it: the list
// anyone may read, each prefab's file and thumbnail, and an upload under a sign-in made through the player's browser
// (the site's ADR 0017). Main makes every request, so the page's `connect-src` stays as it is, and the token never
// reaches the page.

/** Where the gallery is; `BALLEST_RECORDS_URL` points a build elsewhere (a preview of the site). */
export const SITE_URL = "https://ballestrecords.com"

/** A prefab's slug on the site, its one name in every URL there: lowercase words joined by `-`. */
export const SiteSlug = Schema.String.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
)
export type SiteSlug = typeof SiteSlug.Type

/** The tags an uploader picks from, up to `SITE_MAX_TAGS`: the site's own list. */
export const SiteTag = Schema.Literals(["Decoration", "Obstacle", "Ramp", "Loop", "Scenery", "Structure"])
export type SiteTag = typeof SiteTag.Type
export const SITE_MAX_TAGS = 3
/** The longest name and description the site takes, in characters. */
export const SITE_NAME_LIMIT = 64
export const SITE_DESCRIPTION_LIMIT = 500
/** The longest search the site takes. */
export const SITE_QUERY_LIMIT = 100

const Text = (most: number) => Schema.String.check(Schema.isMaxLength(most))
const IsoTime = Text(64)

/** A prefab as the gallery lists it (`GET /api/prefab-list`), less what the panel doesn't show. */
export const SitePrefab = Schema.Struct({
  slug: SiteSlug,
  name: Text(SITE_NAME_LIMIT * 4),
  description: Text(SITE_DESCRIPTION_LIMIT * 4),
  uploader: Schema.Struct({ steamId: Text(20), name: Text(256) }),
  updatedAt: IsoTime,
  pieces: Schema.Int,
  favorites: Schema.Int
})
export type SitePrefab = typeof SitePrefab.Type

/** One page of the gallery, most favourited first: `next` is the cursor of the page after, null at the end. */
export const SitePrefabPage = Schema.Struct({
  total: Schema.Int,
  next: Schema.NullOr(Schema.Int),
  prefabs: Schema.Array(SitePrefab)
})
export type SitePrefabPage = typeof SitePrefabPage.Type

/** `listSitePrefabs`: every word of `query` in the name, description, a tag or the uploader's name; `cursor` from a page. */
export const ListSitePrefabsPayload = Schema.Struct({
  query: Text(SITE_QUERY_LIMIT),
  cursor: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 999_999 })))
})
export type ListSitePrefabsPayload = typeof ListSitePrefabsPayload.Type

export const SiteSlugPayload = Schema.Struct({ slug: SiteSlug })

/** Whether the player is signed in to the site here, as whom, and until when. */
export const SiteAccount = Schema.TaggedUnion({
  SignedOut: {},
  SignedIn: { steamId: Text(20), expiresAt: IsoTime }
})
export type SiteAccount = typeof SiteAccount.Type

/** `signInToSite`'s result: the account, or why not. `Cancelled`: the browser came back without a sign-in. */
export const SiteSignInResult = Schema.TaggedUnion({
  SignedIn: { steamId: Text(20), expiresAt: IsoTime },
  Cancelled: {},
  Failed: { message: Schema.String }
})
export type SiteSignInResult = typeof SiteSignInResult.Type

/** What an upload says about the prefab: the site's own fields, checked as the site checks them. */
export const SiteUploadFields = Schema.Struct({
  name: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(SITE_NAME_LIMIT)),
  description: Text(SITE_DESCRIPTION_LIMIT),
  tags: Schema.Array(SiteTag).check(Schema.isMaxLength(SITE_MAX_TAGS))
})
export type SiteUploadFields = typeof SiteUploadFields.Type

/** How far an angle's zoom and pan may go, as the site checks them (its `checkAngle`). */
export const SITE_ZOOM_RANGE = [0.05, 20] as const
export const SITE_PAN_MAX = 10

const Vec3 = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])

/**
 * The view the uploader picked for the prefab's picture on the site (its `PrefabAngle`): the card, the page and where its
 * viewer starts. It is relative to the prefab's bounds, so it frames the same at any size. `from`: from where the camera
 * looks to the camera, in the renderer's frame (y up). `zoom`: the camera's distance over the one that just fits the
 * whole prefab. `pan`: where it looks, from the prefab's centre, in radii.
 */
export const SiteAngle = Schema.Struct({
  from: Vec3,
  zoom: Schema.Finite.check(
    Schema.isGreaterThanOrEqualTo(SITE_ZOOM_RANGE[0]),
    Schema.isLessThanOrEqualTo(SITE_ZOOM_RANGE[1])
  ),
  pan: Vec3
})
export type SiteAngle = typeof SiteAngle.Type

/** An upload's picked view, and a PNG of it (a data URL) for the site's moderators; null when none was picked. */
export const SiteUploadView = Schema.NullOr(Schema.Struct({
  angle: SiteAngle,
  picture: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1_400_000)))
}))
export type SiteUploadView = typeof SiteUploadView.Type

/**
 * `uploadPrefab`'s result. `Uploaded`: its page. `SignedOut`: no sign-in, or one the site no longer takes (it is
 * forgotten). `Limited`: the hourly uploads are spent until `nextAt`. `Refused`: the site's reasons, as it words them.
 * `Failed`: no answer, or one that isn't any of these.
 */
export const SiteUploadResult = Schema.TaggedUnion({
  Uploaded: { slug: SiteSlug, url: Text(512) },
  SignedOut: {},
  Limited: { nextAt: Schema.NullOr(IsoTime) },
  Refused: { problems: Schema.Array(Schema.String) },
  Failed: { message: Schema.String }
})
export type SiteUploadResult = typeof SiteUploadResult.Type
