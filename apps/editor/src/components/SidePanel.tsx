import { cn } from "@workspace/ui/lib/utils"
import { type ReactNode, useEffect, useRef, useState } from "react"

const STORAGE_PREFIX = "ballest-editor.panel."
/** The viewport never gets narrower than this when a sidebar is dragged wider. */
const MIN_VIEWPORT = 320

/** localStorage, or undefined during server rendering. */
const storage = (): Storage | undefined => (typeof localStorage === "undefined" ? undefined : localStorage)

const readWidth = (id: string, fallback: number): number => {
  const stored = Number(storage()?.getItem(STORAGE_PREFIX + id))
  return Number.isFinite(stored) && stored > 0 ? stored : fallback
}

/** A panel's width as CSS: its saved width once `panelWidthsScript` has run, else the default. */
export const panelWidthVar = (id: string, defaultWidth: number): string => `var(--panel-${id}, ${defaultWidth}px)`

/**
 * Inline <head> script that exposes the saved panel widths as `--panel-<id>` on <html>
 * before first paint, so the server-rendered loading shell lays out like the editor will.
 */
export const panelWidthsScript = `try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(${JSON.stringify(STORAGE_PREFIX)})===0){var w=Number(localStorage.getItem(k));if(w>0)document.documentElement.style.setProperty("--panel-"+k.slice(${STORAGE_PREFIX.length}),w+"px")}}}catch(e){}`

/**
 * A fixed-pixel sidebar with a drag handle on its inner edge. Plain CSS width, so window
 * resizes are laid out by the browser in the same frame as everything else; only the
 * viewport (flex: 1) changes size. The width persists in localStorage.
 */
export function SidePanel(props: {
  readonly id: string
  readonly side: "left" | "right"
  readonly defaultWidth: number
  readonly minWidth: number
  readonly maxWidth: number
  readonly children: ReactNode
}) {
  const [width, setWidth] = useState(() => readWidth(props.id, props.defaultWidth))
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    storage()?.setItem(STORAGE_PREFIX + props.id, String(Math.round(width)))
  }, [props.id, width])

  const clamp = (w: number) => {
    const otherPanels = document.body.clientWidth - (document.querySelector("[data-viewport]")?.clientWidth ?? 0) - width
    const room = document.body.clientWidth - otherPanels - MIN_VIEWPORT
    return Math.max(props.minWidth, Math.min(props.maxWidth, room, w))
  }

  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${props.id}`}
      className={cn(
        "relative w-px shrink-0 cursor-col-resize bg-border after:absolute after:inset-y-0 after:-left-1 after:w-2 hover:bg-primary/60",
        "data-[dragging]:bg-primary"
      )}
      onPointerDown={(e) => {
        drag.current = { startX: e.clientX, startWidth: width }
        e.currentTarget.setPointerCapture(e.pointerId)
        e.currentTarget.dataset["dragging"] = ""
        e.preventDefault()
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return
        const dx = e.clientX - drag.current.startX
        setWidth(clamp(drag.current.startWidth + (props.side === "left" ? dx : -dx)))
      }}
      onPointerUp={(e) => {
        drag.current = null
        delete e.currentTarget.dataset["dragging"]
      }}
      onDoubleClick={() => setWidth(props.defaultWidth)}
    />
  )

  return (
    <>
      {props.side === "right" && handle}
      <div className="min-h-0 shrink-0 overflow-hidden" style={{ width }} data-panel={props.id}>
        {props.children}
      </div>
      {props.side === "left" && handle}
    </>
  )
}
