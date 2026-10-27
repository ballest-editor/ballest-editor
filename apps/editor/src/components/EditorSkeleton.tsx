/**
 * Loading placeholders shaped like the real UI, so nothing jumps when the content arrives.
 * Server-rendered as the route's pending shell, so keep this module free of WebGL and
 * browser-only imports.
 */
import { buttonVariants } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { sceneBackgroundClass } from "../editor/sceneColors"
import { panelWidthVar } from "./SidePanel"
import { ToolBar } from "./ToolBar"
import { TopBar } from "./TopBar"

/** Varied label widths so the placeholder list doesn't look like a barcode. */
const LABEL_WIDTHS = ["45%", "38%", "52%", "41%", "60%", "35%", "48%", "56%", "43%", "50%"]

/**
 * Stand-in for the palette list: a section header and piece rows the same height as the real
 * ones, filling the rest of the panel (clipped, never scrollable).
 */
export function PaletteSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden pr-2" aria-hidden>
      <div className="flex items-center gap-1 px-1 py-1 text-[0.65rem]">
        <span className="flex h-[1lh] items-center">
          <Skeleton className="h-2 w-16 rounded-sm" />
        </span>
        <Skeleton className="ml-auto h-2 w-4 rounded-sm" />
      </div>
      <div className="flex flex-col gap-0.5">
        {Array.from({ length: 48 }, (_, i) => (
          // Same box as a palette entry: an inline-flex PieceButton inside a block <li>.
          <div key={i}>
            <div className={buttonVariants({ variant: "ghost", className: "h-auto w-full justify-start gap-2 px-2 py-1" })}>
              <Skeleton className="size-8 shrink-0 rounded-sm" />
              <Skeleton className="h-2.5 rounded-sm" style={{ width: LABEL_WIDTHS[i % LABEL_WIDTHS.length] }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The editor's layout with placeholder content, shown while the editor's code loads. Panel
 * widths come from the CSS variables set by `panelWidthsScript`, so they match the saved
 * widths the real panels will use.
 */
export function EditorSkeleton() {
  return (
    <div className="flex h-svh flex-col bg-background text-foreground" aria-busy>
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <div className="flex shrink-0 flex-col gap-2 overflow-hidden bg-card p-2" style={{ width: panelWidthVar("palette", 260) }}>
          <div className="px-1 text-[0.65rem] font-semibold tracking-wider text-muted-foreground uppercase">Pieces</div>
          <Input type="search" placeholder="Search pieces…" disabled />
          <PaletteSkeleton />
        </div>
        <div className="w-px shrink-0 bg-border" />
        <div className={`relative min-w-0 flex-1 ${sceneBackgroundClass}`}>
          <ToolBar disabled />
        </div>
        <div className="w-px shrink-0 bg-border" />
        <div className="flex shrink-0 flex-col gap-3 overflow-hidden bg-card p-3" style={{ width: panelWidthVar("inspector", 300) }}>
          <div className="text-[0.65rem] font-semibold tracking-wider text-muted-foreground uppercase">Map</div>
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-10 rounded-sm" />
            <Skeleton className="h-7 w-full" />
          </div>
          <div className="flex flex-col gap-1">
            {LABEL_WIDTHS.slice(0, 5).map((w) => <Skeleton key={w} className="my-0.5 h-3 rounded-sm" style={{ width: w }} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
