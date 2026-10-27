import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { type MouseEvent, type PointerEvent, useEffect, useId, useRef, useState } from "react"

/** Pixels the pointer must travel before a press on the label becomes a scrub (else it's a click). */
const SCRUB_THRESHOLD = 3

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
 * then `onCommit` runs once with the final value if it changed. Escape cancels.
 */
function useScrub(options: {
  readonly value: number
  readonly step: number
  readonly round: (n: number) => number
  readonly onScrub: ((value: number | null) => void) | undefined
  readonly onCommit: (value: number) => void
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
    latest.current.onScrub?.(null)
    if (apply && active.value !== active.startValue) latest.current.onCommit(active.value)
  }
  // Unmounting mid-scrub drops the live value.
  useEffect(() => () => {
    const active = scrub.current
    scrub.current = null
    active?.stop()
    if (active?.value != null) latest.current.onScrub?.(null)
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
      const { step, round, onScrub } = latest.current
      active.value = round(active.startValue + dx * step * (e.shiftKey ? 0.1 : 1))
      onScrub?.(active.value)
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
 * ten times finer) and commits once on release, so a whole scrub is one undo step.
 */
export function NumberField(props: {
  readonly label: string
  readonly value: number
  readonly onCommit: (value: number) => void
  /** Live value while the label is scrubbed; null when the scrub ends or is cancelled. */
  readonly onScrub?: (value: number | null) => void
  readonly step?: number
  readonly digits?: number
}) {
  const id = useId()
  const digits = props.digits ?? 3
  const round = (n: number) => Math.round(n * 10 ** digits) / 10 ** digits
  // Text being typed; otherwise the field shows the current value.
  const [draft, setDraft] = useState<string | null>(null)
  const cancelling = useRef(false)
  const text = draft ?? String(round(props.value))
  const commit = () => {
    const n = Number(draft)
    const valid = draft !== null && draft.trim() !== "" && Number.isFinite(n)
    if (valid && !cancelling.current && n !== props.value) props.onCommit(n)
    cancelling.current = false
    setDraft(null)
  }
  const scrubHandlers = useScrub({
    value: props.value,
    step: props.step ?? 1,
    round,
    onScrub: props.onScrub,
    onCommit: props.onCommit
  })
  const scrubbable = props.onScrub !== undefined
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label
        htmlFor={id}
        className={scrubbable ? "cursor-ew-resize text-muted-foreground select-none" : "text-muted-foreground"}
        title={scrubbable ? "Drag to scrub (Shift: finer, Esc: cancel)" : undefined}
        {...scrubHandlers}
      >
        {props.label}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        className="font-mono"
        value={text}
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
