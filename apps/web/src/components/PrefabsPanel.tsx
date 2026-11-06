import type { PrefabInfo, PrefabTier } from "@ballest/contracts"
import { IconBoxMultiple, IconDotsVertical } from "@tabler/icons-react"
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
import { type MouseEvent, useRef, useState } from "react"
import { qualifyClassPath } from "../domain/prefab"
import { copyPrefabToTier, duplicatePrefab, openPrefab, placePrefab, revealPrefabs } from "../editor/actions"
import { startPrefabDrag } from "../editor/prefabDrag"
import { useEditor } from "../editor/store"
import { focusViewport } from "../editor/Viewport"
import { PieceThumbnail } from "./PieceThumbnail"
import { SectionTitle } from "./SectionTitle"

/** The first piece's picture, else a glyph: a prefab has no picture of its own. */
function PrefabThumbnail({ prefab }: { readonly prefab: PrefabInfo }) {
  const piece = useEditor((s) =>
    prefab.firstClass === null ? undefined : s.catalogIndex?.pieceByClass.get(qualifyClassPath(prefab.firstClass))
  )
  return piece === undefined
    ? (
      <span className="grid size-8 shrink-0 place-items-center rounded-control bg-muted text-fg-secondary">
        <IconBoxMultiple className="size-4" />
      </span>
    )
    : (
      <PieceThumbnail
        piece={piece}
        className="size-8 shrink-0 rounded-control bg-muted object-fill"
        placeholder={<span className="size-8 shrink-0 rounded-control bg-muted" />}
      />
    )
}

/** One prefab: a click places it, a drag onto the viewport does too, and its menu (also on right-click) has the rest. */
function PrefabRow({ prefab }: { readonly prefab: PrefabInfo }) {
  const projects = useEditor((s) => s.capabilities.projects)
  const hasProject = useEditor((s) => s.project?.current != null)
  const openDialog = useEditor((s) => s.openDialog)
  const menuButton = useRef<HTMLButtonElement>(null)
  const { name, tier } = prefab
  const ref = { tier, name }
  const readable = prefab.itemCount !== null
  const otherTier = tier === "user" ? "project" : "user"
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
      className="group flex min-w-0 items-center gap-1 rounded-control pr-1 hover:bg-muted/60"
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        draggable={readable}
        title={prefab.path ?? name}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left outline-none disabled:opacity-60"
        disabled={!readable}
        onClick={place}
        onDragStart={(e) => startPrefabDrag(e.dataTransfer, ref)}
      >
        <PrefabThumbnail prefab={prefab} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body-strong">{name}</span>
          <span className="truncate text-caption text-fg-tertiary">
            {readable ? `${prefab.itemCount} item${prefab.itemCount === 1 ? "" : "s"}` : "Can't be read as a prefab"}
          </span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={menuButton}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
              aria-label={`More for ${name}`}
            />
          }
        >
          <IconDotsVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!readable} onClick={() => void placePrefab(ref)}>Place</DropdownMenuItem>
          <DropdownMenuItem disabled={!readable} onClick={() => void openPrefab(ref)}>Open</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openDialog({ id: "renamePrefab", prefab: ref })}>Rename…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void duplicatePrefab(ref)}>Duplicate</DropdownMenuItem>
          {projects && (
            <DropdownMenuItem
              disabled={otherTier === "project" && !hasProject}
              onClick={() => void copyPrefabToTier(ref, otherTier)}
            >
              Copy to {otherTier}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openDialog({ id: "deletePrefab", prefab: ref })}>Delete…</DropdownMenuItem>
          {projects && <DropdownMenuItem onClick={() => void revealPrefabs(tier)}>Reveal</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

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
  const sections: ReadonlyArray<{ readonly tier: PrefabTier; readonly title: string; readonly empty: string }> =
    projects
      ? [
        {
          tier: "project",
          title: "Project",
          empty: hasProject ? "This project has no prefabs yet." : "Name the project to keep prefabs in it."
        },
        { tier: "user", title: "User", empty: "Prefabs here are the game's own: the in-game editor lists them too." }
      ]
      : [{
        tier: "user",
        title: "This session",
        empty: "Select two or more items, then Edit › Save selection as prefab…"
      }]
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
          {sections.map(({ empty, tier, title }) => (
            <section key={tier} className="flex flex-col gap-1">
              <SectionTitle>{title}</SectionTitle>
              {inTier(tier).length === 0
                ? (
                  <p className="px-2 text-body text-fg-tertiary">
                    {terms.length > 0 ? "Nothing matches the filter." : empty}
                  </p>
                )
                : <ul>{inTier(tier).map((prefab) => <PrefabRow key={prefab.name} prefab={prefab} />)}</ul>}
            </section>
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}
