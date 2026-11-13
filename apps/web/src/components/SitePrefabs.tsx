import { SITE_URL, type SitePrefab, type SitePrefabPage } from "@ballest/contracts"
import { IconDots, IconWorld } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@workspace/ui/components/context-menu"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type MouseEvent, useEffect, useState } from "react"
import { PREFAB_NEEDS_PROJECT, prefabTierLabel } from "../domain/prefab"
import {
  copySitePrefab,
  listSitePrefabs,
  openExternalLink,
  placeSitePrefab,
  readSitePrefabThumb,
  signInToSite,
  signOutOfSite
} from "../editor/actions"
import { NO_TAB_OPEN, noTabOpen, useEditor, useOpenPrefab } from "../editor/store"
import { StripButton } from "./dock/StripButton"
import { EmptySection } from "./EmptySection"
import { THUMBNAIL_TILE, useSeen } from "./PieceThumbnail"

/** How long the search rests before the site is asked. */
const SEARCH_DELAY_MS = 300

const pageOf = (slug: string) => `${SITE_URL}/prefab/${encodeURIComponent(slug)}`

/** The site's own picture of the prefab, asked for once the card comes into view; a glyph until then and without one. */
function SiteThumbnail({ slug }: { readonly slug: string }) {
  const { ref, seen } = useSeen()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!seen) return
    let live = true
    void readSitePrefabThumb(slug).then((found) => {
      if (live) setUrl(found)
    })
    return () => {
      live = false
    }
  }, [seen, slug])
  return (
    <span ref={ref} className="flex w-full">
      {url === null
        ? (
          <span
            className={cn(
              "grid aspect-square w-full place-items-center rounded-control text-fg-secondary",
              THUMBNAIL_TILE
            )}
          >
            <IconWorld className="size-8" />
          </span>
        )
        : <img src={url} alt="" className={cn("aspect-square w-full rounded-control object-cover", THUMBNAIL_TILE)} />}
    </span>
  )
}

/** A site prefab's menu, from its ⋮ and from a right-click. */
function SitePrefabMenuItems({ onPlace, prefab }: { readonly onPlace: () => void; readonly prefab: SitePrefab }) {
  const hasProject = useEditor((s) => s.project?.current != null)
  const inDefinition = useOpenPrefab() !== null
  const noTab = useEditor(noTabOpen)
  return (
    <>
      <span title={noTab ? NO_TAB_OPEN : undefined}>
        <DropdownMenuItem
          disabled={noTab}
          onClick={() => {
            onPlace()
            void placeSitePrefab(prefab)
          }}
        >
          Place in {inDefinition ? "prefab" : "map"}
        </DropdownMenuItem>
      </span>
      <DropdownMenuSeparator />
      <span title={hasProject ? undefined : PREFAB_NEEDS_PROJECT}>
        <DropdownMenuItem disabled={!hasProject} onClick={() => void copySitePrefab(prefab, "project")}>
          Copy to {prefabTierLabel("project", true).toLowerCase()}
        </DropdownMenuItem>
      </span>
      <DropdownMenuItem onClick={() => void copySitePrefab(prefab, "user")}>
        Copy to {prefabTierLabel("user", true).toLowerCase()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => void openExternalLink(pageOf(prefab.slug))}>
        Open on ballestrecords.com
      </DropdownMenuItem>
    </>
  )
}

/** One site prefab as a card: a click places it, closing the window, and its menu has the rest: ⋮, or a right-click. */
function SitePrefabCard({ onPlace, prefab }: { readonly onPlace: () => void; readonly prefab: SitePrefab }) {
  const place = (e: MouseEvent<HTMLButtonElement>) => {
    // as in the tiers' rows, only a real click places
    if (e.detail === 0) return
    onPlace()
    void placeSitePrefab(prefab)
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<li />}
        className="group relative flex min-w-0 flex-col rounded-control p-1 transition-colors hover:bg-hover active:bg-pressed data-popup-open:bg-hover"
      >
        <button
          type="button"
          title={prefab.description === "" ? prefab.name : prefab.description}
          className="flex min-w-0 flex-col gap-1 rounded-control text-left focus-ring"
          onClick={place}
        >
          <SiteThumbnail slug={prefab.slug} />
          <span className="truncate text-body">{prefab.name}</span>
          <span className="truncate text-caption text-fg-tertiary">
            {prefab.uploader.name} · {prefab.pieces} item{prefab.pieces === 1 ? "" : "s"}
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <StripButton
                label="More actions"
                aria-label={`More for ${prefab.name}`}
                className="absolute top-2 right-2 bg-card/80 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100"
              />
            }
          >
            <IconDots />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <SitePrefabMenuItems prefab={prefab} onPlace={onPlace} />
          </DropdownMenuContent>
        </DropdownMenu>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <SitePrefabMenuItems prefab={prefab} onPlace={onPlace} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Sign in, or who is signed in with a way out: what uploading needs. */
function SiteAccountButton() {
  const account = useEditor((s) => s.siteAccount)
  const [signingIn, setSigningIn] = useState(false)
  if (account._tag === "SignedIn") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="link" className="h-auto border-0 px-0 text-caption" />}
          onClick={() => void signOutOfSite()}
        >
          Sign out
        </TooltipTrigger>
        <TooltipContent side="bottom">Signed in, so prefabs can be uploaded from their menus</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="link" className="h-auto border-0 px-0 text-caption" />}
        disabled={signingIn}
        onClick={() => {
          setSigningIn(true)
          void signInToSite().finally(() => setSigningIn(false))
        }}
      >
        {signingIn ? "Signing in…" : "Sign in"}
      </TooltipTrigger>
      <TooltipContent side="bottom">With Steam, in the browser, to upload prefabs</TooltipContent>
    </Tooltip>
  )
}

type Gallery =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Unreachable" }
  | { readonly _tag: "Loaded"; readonly page: SitePrefabPage; readonly more: boolean }

/** What the site answered, and for which search and which try: an answer for another one is still loading. */
interface Answer {
  readonly query: string
  readonly attempt: number
  readonly gallery: Gallery
}

/**
 * ballestrecords.com's gallery (docs/DESKTOP.md § Prefabs) in a window over the editor, opened by the Prefabs panel's
 * Browse ballestrecords: players' prefabs as cards, most favourited first, a page at a time, with a search of its own.
 * Desktop only: the page's own requests stay on its own origin, so main asks the site.
 */
export function SiteGalleryDialog({ onClose, open }: { readonly onClose: () => void; readonly open: boolean }) {
  const [query, setQuery] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [answer, setAnswer] = useState<Answer | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    const timer = setTimeout(() => {
      void listSitePrefabs(query, null).then((page) => {
        if (!live) return
        const gallery: Gallery = page === null ? { _tag: "Unreachable" } : { _tag: "Loaded", page, more: false }
        setAnswer({ query, attempt, gallery })
      })
    }, SEARCH_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [open, query, attempt])
  const gallery: Gallery = answer?.query === query && answer.attempt === attempt
    ? answer.gallery
    : { _tag: "Loading" }
  const more = (page: SitePrefabPage, next: number) => {
    setAnswer({ query, attempt, gallery: { _tag: "Loaded", page, more: true } })
    void listSitePrefabs(query, next).then((after) => {
      const joined = after === null ? page : { ...after, prefabs: [...page.prefabs, ...after.prefabs] }
      // a page that comes back after the search changed belongs to the old one: the new search's answer stays
      setAnswer((current) =>
        current?.query === query && current.attempt === attempt
          ? { query, attempt, gallery: { _tag: "Loaded", page: joined, more: false } }
          : current
      )
    })
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>ballestrecords</DialogTitle>
          <DialogDescription>
            Players' prefabs from ballestrecords.com. Placing one keeps a copy in the project, or in the game without
            one.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <Input
            type="search"
            aria-label="Search ballestrecords"
            placeholder="Search players' prefabs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <SiteAccountButton />
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {gallery._tag === "Loading"
            ? <EmptySection line="Loading…" />
            : gallery._tag === "Unreachable"
            ? (
              <EmptySection line="Couldn't reach ballestrecords.com.">
                <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
              </EmptySection>
            )
            : gallery.page.prefabs.length === 0
            ? <EmptySection line={query.trim() === "" ? "No prefabs yet." : "Nothing matches the search."} />
            : (
              <div className="flex flex-col gap-2">
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
                  {gallery.page.prefabs.map((prefab) => (
                    <SitePrefabCard key={prefab.slug} prefab={prefab} onPlace={onClose} />
                  ))}
                </ul>
                {gallery.page.next !== null && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={gallery.more}
                    onClick={() => {
                      if (gallery.page.next !== null) more(gallery.page, gallery.page.next)
                    }}
                  >
                    {gallery.more ? "Loading…" : `More (${gallery.page.total - gallery.page.prefabs.length})`}
                  </Button>
                )}
              </div>
            )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
