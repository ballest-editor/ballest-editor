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
import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { termsOf } from "../domain/outline"
import { PREFAB_NEEDS_PROJECT, PREFAB_TIER_HINTS, prefabTierLabel } from "../domain/prefab"
import { instancesOfPrefab } from "../domain/prefabInstance"
import {
  copyPrefabToTier,
  duplicatePrefab,
  openPrefab,
  placePrefab,
  readDefinitionItems,
  revealPrefabs,
  selectInstances
} from "../editor/actions"
import { startPrefabDrag } from "../editor/prefabDrag"
import { NO_TAB_OPEN, noTabOpen, useEditor, useOpenPrefab } from "../editor/store"
import { definitionThumbnailFor } from "../editor/thumbnails"
import { focusViewport } from "../editor/Viewport"
import { StripButton } from "./dock/StripButton"
import { THUMBNAIL_TILE, useSeen } from "./PieceThumbnail"
import { SectionTitle } from "./SectionTitle"

/** Everything in the definition, framed whole; a glyph until that has rendered, and for a file that won't read. */
export function PrefabThumbnail({ prefab }: { readonly prefab: PrefabInfo }) {
  const index = useEditor((s) => s.catalogIndex)
  const table = useEditor((s) => s.materialTable)
  const { ref, seen } = useSeen()
  // by version of the file, so a render that lands late can't stand in for the file as it is now
  const [renders, setRenders] = useState<Readonly<Record<string, string | undefined>>>({})
  useEffect(() => {
    if (!seen || index === null || table === null || prefab.itemCount === null) return
    void definitionThumbnailFor(prefab, () => readDefinitionItems(prefab), index, table).then((url) =>
      setRenders((known) => ({ ...known, [prefab.hash]: url }))
    )
  }, [prefab, seen, index, table])
  const rendered = renders[prefab.hash]
  return (
    <span ref={ref} className="flex shrink-0">
      {rendered === undefined
        ? (
          <span
            className={cn(
              "grid size-6 place-items-center rounded-control",
              THUMBNAIL_TILE,
              prefab.itemCount === null ? "text-fg-disabled" : "text-fg-secondary"
            )}
          >
            <IconBoxMultiple className="size-4" />
          </span>
        )
        : <img src={rendered} alt="" className={cn("size-6 rounded-control object-fill", THUMBNAIL_TILE)} />}
    </span>
  )
}

/** One prefab: a click places it, a drag onto the viewport does too, and its menu (also on right-click) has the rest. */
function PrefabRow({ prefab }: { readonly prefab: PrefabInfo }) {
  const projects = useEditor((s) => s.capabilities.projects)
  const hasProject = useEditor((s) => s.project?.current != null)
  const openDialog = useEditor((s) => s.openDialog)
  const inDefinition = useOpenPrefab() !== null
  const noTab = useEditor(noTabOpen)
  const tree = useEditor((s) => s.doc.structure.tree)
  const placed = useMemo(() => instancesOfPrefab(tree, prefab).length, [tree, prefab])
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
      className="group flex h-8 min-w-0 items-center gap-1 rounded-control pr-1 transition-colors focus-ring-row hover:bg-hover active:bg-pressed"
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        draggable={readable}
        title={readable ? prefab.path ?? name : "Can't be read as a prefab"}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2 rounded-control pl-2 text-left focus-visible:outline-none",
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
          {placed > 0 && " ·"}
        </span>
      </button>
      {placed > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="link"
                className="h-auto shrink-0 border-0 px-0 text-caption"
                onClick={() => {
                  selectInstances(ref)
                  focusViewport()
                }}
              />
            }
          >
            {placed} placed
          </TooltipTrigger>
          <TooltipContent side="bottom">Select {placed === 1 ? "it" : "them"} in this map</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={menuButton}
          render={
            <StripButton
              label="More actions"
              aria-label={`More for ${name}`}
              className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100"
            />
          }
        >
          <IconDots />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <span title={noTab ? NO_TAB_OPEN : undefined}>
            <DropdownMenuItem disabled={!readable || noTab} onClick={() => void placePrefab(ref)}>
              Place in {inDefinition ? "prefab" : "map"}
            </DropdownMenuItem>
          </span>
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
          {projects && <DropdownMenuItem onClick={() => void revealPrefabs(tier)}>Reveal in folder</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/** A section with nothing to list: one line, centred, and what to do about it underneath if there is anything. */
export function EmptySection({ children, line }: { readonly children?: ReactNode; readonly line: string }) {
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

const DESKTOP_TIERS: ReadonlyArray<{ readonly tier: PrefabTier; readonly hint: string }> = [
  { tier: "project", hint: PREFAB_TIER_HINTS.project },
  { tier: "user", hint: PREFAB_TIER_HINTS.user }
]

const BROWSER_TIERS: typeof DESKTOP_TIERS = [{ tier: "user", hint: "Kept in memory until the page closes." }]

/** The library of prefabs (docs/DESKTOP.md § Prefabs), one section per tier. A browser has the one tier, in memory. */
export function PrefabsPanel() {
  const prefabs = useEditor((s) => s.prefabs)
  const projects = useEditor((s) => s.capabilities.projects)
  const hasProject = useEditor((s) => s.project?.current != null)
  const [query, setQuery] = useState("")
  const terms = termsOf(query)
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
              <Tooltip>
                <TooltipTrigger render={<div className="w-fit px-2" />}>
                  <SectionTitle>{prefabTierLabel(tier, projects)}</SectionTitle>
                </TooltipTrigger>
                <TooltipContent side="right">{hint}</TooltipContent>
              </Tooltip>
              {inTier(tier).length > 0
                ? (
                  <ul className="flex flex-col gap-0.5">
                    {inTier(tier).map((prefab) => <PrefabRow key={prefab.name} prefab={prefab} />)}
                  </ul>
                )
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
