/**
 * Loading placeholders shaped like the real UI, so nothing jumps when the content arrives.
 * The route's pending component, in the first chunk the page loads, so keep this module
 * free of WebGL imports: they belong in the editor's chunk.
 */
import { buttonVariants } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { sceneBackgroundClass } from "../editor/sceneColors"
import { SectionTitle } from "./SectionTitle"
import { TopBar } from "./TopBar"
import { ViewportControls } from "./ViewControls"

/** Varied label widths so the placeholder list doesn't look like a barcode. */
const LABEL_WIDTHS = ["45%", "38%", "52%", "41%", "60%", "35%", "48%", "56%", "43%", "50%"]

/**
 * Stand-in for the palette list: a section header and piece rows the same height as the real
 * ones, filling the rest of the panel (clipped, never scrollable).
 */
export function PaletteSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2" aria-hidden>
      <div className="flex h-8 items-center gap-1 px-1.5 text-caption uppercase tracking-wider">
        <span className="flex h-[1lh] items-center">
          <Skeleton className="h-2 w-16 rounded-control" />
        </span>
        <Skeleton className="ml-auto h-2 w-4 rounded-control" />
      </div>
      <div className="flex flex-col gap-0.5">
        {Array.from({ length: 48 }, (_, i) => (
          // Same box as a palette entry.
          <div key={i}>
            <div
              className={buttonVariants({ variant: "ghost", className: "flex h-8 w-full justify-start gap-2 px-1" })}
            >
              <Skeleton className="size-6 shrink-0 rounded-control" />
              <Skeleton className="h-2.5 rounded-control" style={{ width: LABEL_WIDTHS[i % LABEL_WIDTHS.length] }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** How much of the window a side of the dock takes: index.html sets these from the saved layout before first paint. */
const dockSide = (side: "left" | "right" | "bottom", fallback: number): string => `var(--dock-${side}, ${fallback}px)`

/**
 * The dock with placeholder content, sized by the saved layout. Shown while the editor's code loads and over the dock
 * until its layout is in, so the panels don't jump. A side's content is a stand-in: the saved layout may hold another
 * panel there, or none.
 */
export function EditorSkeletonPanels({ className }: { readonly className?: string }) {
  return (
    <div className={cn("flex min-h-0 flex-1 bg-background", className)}>
      <div
        className="shrink-0 overflow-hidden bg-card shadow-[inset_-1px_0_0_var(--border)]"
        style={{ width: dockSide("left", 260) }}
      >
        <div className="h-7 bg-background" />
        <div className="flex h-full flex-col">
          <div className="flex h-9 shrink-0 items-center px-2">
            <Input type="search" placeholder="Search pieces…" disabled />
          </div>
          <PaletteSkeleton />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-8 shrink-0 bg-background" />
        <div className={`relative min-h-0 flex-1 ${sceneBackgroundClass}`}>
          <ViewportControls disabled />
        </div>
        <div
          className="shrink-0 bg-card shadow-[inset_0_1px_0_var(--border)]"
          style={{ height: dockSide("bottom", 0) }}
        />
      </div>
      <div
        className="shrink-0 overflow-hidden bg-card shadow-[inset_1px_0_0_var(--border)]"
        style={{ width: dockSide("right", 300) }}
      >
        <div className="h-7 border-b" />
        <div className="flex flex-col gap-3 p-3">
          <SectionTitle>Map</SectionTitle>
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-10 rounded-control" />
            <Skeleton className="h-7 w-full" />
          </div>
          <div className="flex flex-col gap-1">
            {LABEL_WIDTHS.slice(0, 5).map((w) => (
              <Skeleton key={w} className="my-0.5 h-3 rounded-control" style={{ width: w }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Whether main started this window on the start screen (`DesktopWindow`), known from the first frame. `ProjectState`
 * has the last word once it arrives, so a reload after a pick costs nothing.
 */
export const startsOnChooser = (): boolean => new URLSearchParams(window.location.search).has("chooser")

/** The empty window a start screen comes up in, with no editor to take it for. */
export function ChooserSkeleton() {
  return <div className="h-svh bg-background" aria-busy />
}

/** The editor's layout with placeholder content, shown while the editor's code loads. */
export function EditorSkeleton() {
  if (startsOnChooser()) return <ChooserSkeleton />
  return (
    <div className="flex h-svh flex-col bg-background text-foreground" aria-busy>
      <TopBar />
      <EditorSkeletonPanels />
    </div>
  )
}
