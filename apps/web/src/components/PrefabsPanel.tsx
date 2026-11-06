import type { PrefabInfo, PrefabTier } from "@ballest/contracts"
import { IconBoxMultiple, IconDots } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
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
import { type MouseEvent, type ReactNode, useRef, useState } from "react"
import { PREFAB_NEEDS_PROJECT, prefabTierLabel, qualifyClassPath } from "../domain/prefab"
import { copyPrefabToTier, duplicatePrefab, openPrefab, placePrefab, revealPrefabs } from "../editor/actions"
import { startPrefabDrag } from "../editor/prefabDrag"
import { useEditor, useOpenPrefab } from "../editor/store"
import { focusViewport } from "../editor/Viewport"
import { PieceThumbnail, THUMBNAIL_TILE } from "./PieceThumbnail"
import { SectionTitle } from "./SectionTitle"

/** The first piece's picture, else a glyph: a prefab has no picture of its own. */
function PrefabThumbnail({ prefab }: { readonly prefab: PrefabInfo }) {
  const piece = useEditor((s) =>
    prefab.firstClass === null ? undefined : s.catalogIndex?.pieceByClass.get(qualifyClassPath(prefab.firstClass))
  )
  const glyph = (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-control",
        THUMBNAIL_TILE,
        prefab.itemCount === null ? "text-fg-disabled" : "text-fg-secondary"
      )}
    >
      <IconBoxMultiple className="size-4" />
    </span>
  )
  return piece === undefined
    ? glyph
    : (
      <PieceThumbnail
        piece={piece}
        className={cn("size-6 shrink-0 rounded-control object-fill", THUMBNAIL_TILE)}
        placeholder={glyph}
      />
    )
}

/** One prefab: a click places it, a drag onto the viewport does too, and its menu (also on right-click) has the rest. */
function PrefabRow({ prefab }: { readonly prefab: PrefabInfo }) {
  const projects = useEditor((s) => s.capabilities.projects)
  const hasProject = useEditor((s) => s.project?.current != null)
  const openDialog = useEditor((s) => s.openDialog)
  const inDefinition = useOpenPrefab() !== null
  const menuButton = useRef<HTMLButtonElement>(null)
  const { name, tier } = prefab
  const ref = { tier, name }
  const readable = prefab.itemCount !== null
  const otherTier = tier === "user" ? "project" : "user"
  const needsProject = otherTier === "project" && !hasProject
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    menuButton.current?.click()
  }
  const place = (e: MouseEvent<HTMLButtonElement>) => {
    // keyboard activation is a click with no count: as in the palette, only a real click places
    if (e.detail === 0 || !readable) return
    void placePrefab(ref)
    e.currentTarget.blur()
    focusViewport()
  }
  return (
    <li
      className="group flex h-8 min-w-0 items-center gap-1 rounded-control pr-1 transition-colors duration-150 ease-out hover:bg-accent"
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        draggable={readable}
        title={readable ? prefab.path ?? name : "Can't be read as a prefab"}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2 rounded-control pl-2 text-left outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          readable ? "cursor-grab active:cursor-grabbing" : "text-fg-disabled"
        )}
        disabled={!readable}
        onClick={place}
        onDragStart={(e) => startPrefabDrag(e.dataTransfer, ref)}
      >
        <PrefabThumbnail prefab={prefab} />
        <span className="min-w-0 flex-1 truncate text-body">{name}</span>
        <span className={cn("shrink-0 text-caption", readable ? "text-fg-tertiary" : "text-fg-disabled")}>
          {readable ? `${prefab.itemCount} item${prefab.itemCount === 1 ? "" : "s"}` : "Unreadable"}
        </span>
      </button>
      <DropdownMenu>
        <Tooltip
          // the menu hands the focus back as it closes, and the tooltip would stay up with the pointer long gone
          onOpenChange={(open, details) => {
            if (open && details.reason === "trigger-focus") details.cancel()
          }}
        >
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                ref={menuButton}
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100"
                    aria-label={`More for ${name}`}
                  />
                }
              />
            }
          >
            <IconDots />
          </TooltipTrigger>
          <TooltipContent side="bottom">More actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!readable} onClick={() => void placePrefab(ref)}>
            Place in {inDefinition ? "prefab" : "map"}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!readable} onClick={() => void openPrefab(ref)}>Open definition</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openDialog({ id: "renamePrefab", prefab: ref })}>Rename…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void duplicatePrefab(ref)}>Duplicate</DropdownMenuItem>
          {projects && (
            <span title={needsProject ? PREFAB_NEEDS_PROJECT : undefined}>
              <DropdownMenuItem disabled={needsProject} onClick={() => void copyPrefabToTier(ref, otherTier)}>
                Copy to {prefabTierLabel(otherTier, projects).toLowerCase()}
              </DropdownMenuItem>
            </span>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openDialog({ id: "deletePrefab", prefab: ref })}>Delete…</DropdownMenuItem>
          {projects && <DropdownMenuItem onClick={() => void revealPrefabs(tier)}>Reveal</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/** A section's eyebrow; the tooltip says where its prefabs are kept, which the one word can't. */
function TierTitle({ children, hint }: { readonly children: string; readonly hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="w-fit px-2" />}>
        <SectionTitle>{children}</SectionTitle>
      </TooltipTrigger>
      <TooltipContent side="right">{hint}</TooltipContent>
    </Tooltip>
  )
}

/** A section with nothing to list: one line, centred, and what to do about it underneath if there is anything. */
function EmptySection({ children, line }: { readonly children?: ReactNode; readonly line: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-1 text-center">
      <p className="text-body text-fg-tertiary">{line}</p>
      {children}
    </div>
  )
}

/** Untitled Project has no project tier: its section names the project from here. */
function NoProject() {
  const openDialog = useEditor((s) => s.openDialog)
  return (
    <EmptySection line="No project yet.">
      <Button variant="outline" size="sm" onClick={() => openDialog({ id: "projectSettings" })}>
        Name it…
      </Button>
    </EmptySection>
  )
}

/** Where a tier keeps its prefabs, for its section here and its segment in Save selection as prefab. */
export const PREFAB_TIER_HINTS: Readonly<Record<PrefabTier, string>> = {
  project: "Kept with this project.",
  user: "The game's own prefabs: the in-game editor lists them too."
}

const DESKTOP_TIERS: ReadonlyArray<{ readonly tier: PrefabTier; readonly hint: string }> = [
  { tier: "project", hint: PREFAB_TIER_HINTS.project },
  { tier: "user", hint: PREFAB_TIER_HINTS.user }
]

const BROWSER_TIERS: typeof DESKTOP_TIERS = [{ tier: "user", hint: "Kept in memory until the page closes." }]

/**
 * The library of prefabs (docs/DESKTOP.md § Prefabs), one section per tier. A browser has the one tier, in memory.
 */
export function PrefabsPanel() {
  const prefabs = useEditor((s) => s.prefabs)
  const projects = useEditor((s) => s.capabilities.projects)
  const hasProject = useEditor((s) => s.project?.current != null)
  const [query, setQuery] = useState("")
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
  const inTier = (tier: PrefabTier) =>
    prefabs.filter((p) => p.tier === tier && terms.every((term) => p.name.toLowerCase().includes(term)))
  return (
    <aside className="flex h-full min-w-0 flex-col gap-2 bg-card p-2">
      <Input
        type="search"
        aria-label="Filter the prefabs"
        placeholder="Filter prefabs…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("")
        }}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3">
          {(projects ? DESKTOP_TIERS : BROWSER_TIERS).map(({ hint, tier }) => (
            <section key={tier} className="flex flex-col gap-1">
              <TierTitle hint={hint}>{prefabTierLabel(tier, projects)}</TierTitle>
              {inTier(tier).length > 0
                ? <ul>{inTier(tier).map((prefab) => <PrefabRow key={prefab.name} prefab={prefab} />)}</ul>
                : terms.length > 0
                ? <EmptySection line="Nothing matches the filter." />
                : tier === "project" && !hasProject
                ? <NoProject />
                : <EmptySection line="No prefabs yet." />}
            </section>
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}
