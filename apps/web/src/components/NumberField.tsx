import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { type MouseEvent, type PointerEvent, useEffect, useId, useRef, useState } from "react"
import { snapValue } from "../domain/snap"

/** Pixels the pointer must travel before a press on the label becomes a scrub (else it's a click). */
const SCRUB_THRESHOLD = 3

/** A snapped scrub moves at least one snap step per this many pixels, however big the step. */
const PIXELS_PER_SNAP = 10

interface Scrub {
  readonly pointerId: number
  readonly startX: number
  readonly startValue: number
  /** Null until the pointer has moved past the threshold. */
  value: number | null
  readonly stop: () => void
}

/**
 * Drag-to-scrub on a label: `onScrub` gets each live value and `null` when the scrub ends,
 * then `onCommit` runs once with the final value if it changed. Both also get the value the
 * scrub started from, since the shown value follows the live one. Escape cancels.
 */
function useScrub(options: {
  readonly value: number
  readonly step: number
  readonly snap: number | undefined
  readonly round: (n: number) => number
  readonly onScrub: ((value: number | null, from: number) => void) | undefined
  readonly onCommit: (value: number, from: number) => void
}) {
  const scrub = useRef<Scrub | null>(null)
  const scrubbed = useRef(false)
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  const end = (apply: boolean) => {
    const active = scrub.current
    if (active === null) return
    scrub.current = null
    active.stop()
    if (active.value === null) return // a plain click: the label focuses the input
    scrubbed.current = true
    latest.current.onScrub?.(null, active.startValue)
    if (apply && active.value !== active.startValue) latest.current.onCommit(active.value, active.startValue)
  }
  // Unmounting mid-scrub drops the live value.
  useEffect(() => () => {
    const active = scrub.current
    scrub.current = null
    active?.stop()
    if (active?.value != null) latest.current.onScrub?.(null, active.startValue)
  }, [])

  if (options.onScrub === undefined) return {}
  return {
    onPointerDown: (e: PointerEvent<HTMLLabelElement>) => {
      if (e.button !== 0 || scrub.current !== null) return
      const onKeyDown = (k: KeyboardEvent) => {
        if (k.code !== "Escape") return
        k.preventDefault()
        k.stopImmediatePropagation() // don't also deselect
        end(false)
      }
      window.addEventListener("keydown", onKeyDown, { capture: true })
      scrub.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startValue: latest.current.value,
        value: null,
        stop: () => window.removeEventListener("keydown", onKeyDown, { capture: true })
      }
      scrubbed.current = false
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // synthetic events (automation) have no capturable pointer
      }
    },
    onPointerMove: (e: PointerEvent<HTMLLabelElement>) => {
      const active = scrub.current
      if (active === null || active.pointerId !== e.pointerId) return
      const dx = Math.round(e.clientX - active.startX)
      if (active.value === null && Math.abs(dx) < SCRUB_THRESHOLD) return
      const { step, snap, round, onScrub } = latest.current
      if (snap === undefined) {
        active.value = round(active.startValue + dx * step * (e.shiftKey ? 0.1 : 1))
      } else {
        const perPixel = Math.max(step, snap / PIXELS_PER_SNAP) * (e.shiftKey ? 0.1 : 1)
        active.value = round(snapValue(active.startValue + dx * perPixel, snap))
      }
      onScrub?.(active.value, active.startValue)
    },
    onPointerUp: () => end(true),
    onPointerCancel: () => end(false),
    // the click that ends a scrub mustn't focus the input
    onClick: (e: MouseEvent<HTMLLabelElement>) => {
      if (scrubbed.current) e.preventDefault()
      scrubbed.current = false
    }
  }
}

/**
 * Numeric input that commits on Enter or blur and reverts on Escape or invalid input.
 * With `onScrub`, dragging the label left/right scrubs the value (`step` per pixel, Shift
 * ten times finer) and commits once on release (`onScrubCommit`, else `onCommit`), so a
 * whole scrub is one undo step. With `snap`, a scrub lands on multiples of it (and moves
 * faster when the snap is coarse); typed values aren't snapped. A null `value` is mixed (several items that disagree): the
 * input is blank, typing sets them all, and a scrub starts from 0.
 */
export function NumberField(props: {
  readonly label: string
  readonly value: number | null
  readonly onCommit: (value: number) => void
  /**
   * Live value while the label is scrubbed; null when the scrub ends or is cancelled.
   * `from` is the value the scrub started from.
   */
  readonly onScrub?: (value: number | null, from: number) => void
  /** The value a finished scrub ends on, and the one it started from; defaults to `onCommit`. */
  readonly onScrubCommit?: (value: number, from: number) => void
  readonly step?: number
  /** Scrubs land on multiples of this. */
  readonly snap?: number | undefined
  readonly digits?: number
  /** Background class for the handle, e.g. an axis colour. */
  readonly handleClassName?: string
  /** Whether the coloured handle (the scrub grip) is drawn; without it the field is a plain input. */
  readonly handle?: boolean
}) {
  const id = useId()
  const digits = props.digits ?? 3
  const round = (n: number) => Math.round(n * 10 ** digits) / 10 ** digits
  // Text being typed; otherwise the field shows the current value.
  const [draft, setDraft] = useState<string | null>(null)
  const cancelling = useRef(false)
  const text = draft ?? (props.value === null ? "" : round(props.value).toFixed(digits))
  const commit = () => {
    const n = Number(draft)
    const valid = draft !== null && draft.trim() !== "" && Number.isFinite(n)
    if (valid && !cancelling.current && n !== props.value) props.onCommit(n)
    cancelling.current = false
    setDraft(null)
  }
  const scrubHandlers = useScrub({
    value: props.value ?? 0,
    step: props.step ?? 1,
    snap: props.snap,
    round,
    onScrub: props.onScrub,
    onCommit: props.onScrubCommit ?? props.onCommit
  })
  const scrubbable = props.onScrub !== undefined
  return (
    <div className="flex h-7 min-w-0 overflow-hidden rounded-md border border-input bg-input/20 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 dark:bg-input/30">
      {props.handle !== false && (
        <Label
          htmlFor={id}
          aria-label={props.label}
          className={`w-2 shrink-0 ${props.handleClassName ?? "bg-muted"} ${
            scrubbable ? "cursor-ew-resize hover:brightness-125" : ""
          }`}
          {...scrubHandlers}
        />
      )}
      <Input
        id={id}
        aria-label={props.handle === false ? props.label : undefined}
        inputMode="decimal"
        className="h-full min-w-0 rounded-none border-0 bg-transparent px-1 py-0 text-right font-mono tabular-nums leading-none focus-visible:border-0 focus-visible:ring-0 md:leading-none dark:bg-transparent"
        value={text}
        placeholder={props.value === null ? "Mixed" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") {
            cancelling.current = true
            e.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}
