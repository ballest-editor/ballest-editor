import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { cn } from "@workspace/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

/** Where the pill sits inside the track, in the track's own pixels. */
interface PillBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The offsets chain to the track, so a popup opening with a transform doesn't skew them as a client rect would. */
const pillBoxOf = (track: HTMLElement): PillBox | null => {
  const pressed = track.querySelector<HTMLElement>("[aria-pressed='true']")
  if (pressed === null) return null
  let x = 0
  let y = 0
  for (
    let node: Element | null = pressed;
    node instanceof HTMLElement && node !== track;
    node = node.offsetParent
  ) {
    x += node.offsetLeft
    y += node.offsetTop
  }
  return { x, y, width: pressed.offsetWidth, height: pressed.offsetHeight }
}

const samePillBox = (a: PillBox | null, b: PillBox | null) =>
  a?.x === b?.x && a?.y === b?.y && a?.width === b?.width && a?.height === b?.height

/**
 * Follows the pressed item. It watches the DOM rather than `value`, so a tooltip wrapped round an item or a group that
 * changes size can't leave the pill behind; a group with several pressed items has no single place for one.
 */
function usePillBox(track: React.RefObject<HTMLDivElement | null>, enabled: boolean): PillBox | null {
  const [box, setBox] = React.useState<PillBox | null>(null)

  React.useLayoutEffect(() => {
    const root = track.current
    if (root === null || !enabled) return
    const measure = () => {
      const next = pillBoxOf(root)
      setBox((current) => samePillBox(current, next) ? current : next)
    }
    measure()
    const sizes = new ResizeObserver(measure)
    sizes.observe(root)
    for (const item of root.querySelectorAll("[data-slot=toggle-group-item]")) sizes.observe(item)
    const presses = new MutationObserver(measure)
    presses.observe(root, { attributes: true, attributeFilter: ["aria-pressed"], childList: true, subtree: true })
    return () => {
      sizes.disconnect()
      presses.disconnect()
    }
  }, [track, enabled])

  return enabled ? box : null
}

const pillVariants = cva(
  "pointer-events-none absolute top-0 left-0 rounded-[calc(var(--radius-control)-2px)] transition-[transform,width,height] duration-150 group-[.rounded-full]/toggle-group:rounded-full",
  {
    variants: {
      pill: {
        neutral: "bg-card shadow-sm dark:bg-foreground/15",
        primary: "bg-primary shadow-primary"
      }
    },
    defaultVariants: {
      pill: "neutral"
    }
  }
)

/** The item's size inside a track: the track's 2px of padding each side keep the whole group on the control heights. */
const ITEM =
  "relative z-1 inline-flex shrink-0 items-center justify-center gap-1 rounded-[calc(var(--radius-control)-2px)] text-body-strong whitespace-nowrap text-fg-secondary transition-colors focus-ring group-[.rounded-full]/toggle-group:rounded-full hover:bg-hover hover:text-foreground active:bg-pressed disabled:pointer-events-none disabled:text-fg-disabled aria-pressed:text-foreground aria-pressed:hover:bg-transparent aria-pressed:active:bg-transparent group-data-multiple/toggle-group:aria-pressed:bg-selected group-data-multiple/toggle-group:aria-pressed:hover:lift-selected group-data-multiple/toggle-group:aria-pressed:active:press-selected group-data-[pill=primary]/toggle-group:aria-pressed:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 h-6 min-w-6 px-2"

/**
 * One rounded track with a pill that slides to the pressed item. `pill="primary"` is for the active tool, where the
 * choice is the state of the editor; `neutral` is for a setting. Add `rounded-full` for a pill-shaped track.
 */
function ToggleGroup({
  className,
  pill = "neutral",
  children,
  ...props
}: ToggleGroupPrimitive.Props & VariantProps<typeof pillVariants>) {
  const track = React.useRef<HTMLDivElement>(null)
  const box = usePillBox(track, props.multiple !== true)

  return (
    <ToggleGroupPrimitive
      ref={track}
      data-slot="toggle-group"
      data-pill={pill}
      className={cn(
        "group/toggle-group relative flex w-fit flex-row items-center gap-0.5 rounded-control bg-muted p-0.5",
        className
      )}
      {...props}
    >
      {box !== null && (
        <span
          aria-hidden
          data-slot="toggle-group-pill"
          className={pillVariants({ pill })}
          style={{ width: box.width, height: box.height, transform: `translate(${box.x}px, ${box.y}px)` }}
        />
      )}
      {children}
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({ className, ...props }: TogglePrimitive.Props) {
  return <TogglePrimitive data-slot="toggle-group-item" className={cn(ITEM, className)} {...props} />
}

export { ToggleGroup, ToggleGroupItem }
