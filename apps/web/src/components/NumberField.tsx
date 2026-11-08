import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"
import { type MouseEvent, type PointerEvent, useEffect, useId, useRef, useState } from "react"
import { applyNumberEntry, parseNumberEntry, scrubbedValue, scrubSpeedOf } from "../domain/numberEntry"
import { clearStatusHint, showStatusHint, type StatusHint } from "../editor/statusHint"

/** Pixels the pointer must travel before a press becomes a scrub (else it's a click). */
const SCRUB_THRESHOLD = 3

interface Scrub {
  readonly pointerId: number
  readonly startValue: number
  /** Where the pointer last counted from. */
  x: number
  /** The pixels dragged so far, each at the speed its modifier keys gave it, so pressing one mid-drag doesn't jump. */
  pixels: number
  /** Null until the pointer has moved past the threshold. */
  value: number | null
  readonly stop: () => void
}

/**
 * Drag-to-scrub on the field and its label: `onScrub` gets each live value and `null` when the
 * scrub ends, then `onCommit` runs once with the final value if it changed. Both also get the
 * value the scrub started from, since the shown value follows the live one. A press that never
 * moves is `onClick`'s. An element holding the focus keeps its press, so a caret can be placed
 * in text being typed. Escape cancels.
 */
function useScrub(options: {
  readonly value: number
  readonly step: number
  readonly snap: number | undefined
  readonly round: (n: number) => number
  readonly onScrub: ((value: number | null, from: number) => void) | undefined
  readonly onCommit: (value: number, from: number) => void
  readonly onClick: () => void
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
    if (active.value === null) {
      if (apply) latest.current.onClick()
      return
    }
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
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      const { activeElement, defaultView } = e.currentTarget.ownerDocument
      if (e.button !== 0 || scrub.current !== null || activeElement === e.currentTarget) return
      // the window the field is in: a panel popped out has one of its own
      const fieldWindow = defaultView ?? window
      // `onMouseDown` holds the focus where it is, so this has to end another field's typing itself
      if (activeElement instanceof fieldWindow.HTMLElement) activeElement.blur()
      const onKeyDown = (k: KeyboardEvent) => {
        if (k.code !== "Escape") return
        k.preventDefault()
        k.stopImmediatePropagation() // don't also deselect
        end(false)
      }
      fieldWindow.addEventListener("keydown", onKeyDown, { capture: true })
      scrub.current = {
        pointerId: e.pointerId,
        startValue: latest.current.value,
        x: e.clientX,
        pixels: 0,
        value: null,
        stop: () => fieldWindow.removeEventListener("keydown", onKeyDown, { capture: true })
      }
      scrubbed.current = false
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // synthetic events (automation) have no capturable pointer
      }
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const active = scrub.current
      if (active === null || active.pointerId !== e.pointerId) return
      const dx = e.clientX - active.x
      if (active.value === null && Math.abs(dx) < SCRUB_THRESHOLD) return
      active.x = e.clientX
      active.pixels += dx * scrubSpeedOf(e)
      const { step, snap, round, onScrub } = latest.current
      active.value = round(scrubbedValue(active.startValue, active.pixels, step, snap))
      onScrub?.(active.value, active.startValue)
    },
    onPointerUp: () => end(true),
    onPointerCancel: () => end(false),
    // a press that may become a scrub neither focuses the input nor starts selecting its text
    onMouseDown: (e: MouseEvent<HTMLElement>) => {
      if (scrub.current !== null) e.preventDefault()
    },
    // the click that ends a scrub mustn't focus the input
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (scrubbed.current) e.preventDefault()
      scrubbed.current = false
    }
  }
}

/** The status bar's hint over a field that scrubs; a scrub keeps it, as the pointer is still on the field. */
const SCRUB_HINT: StatusHint = [
  { keys: "Mouse0", text: "Drag to change" },
  { keys: "Shift", text: "10× faster" },
  { keys: "Alt", text: "10× slower" },
  { keys: "Mouse0", text: "Click to type" }
]

const TYPING_HINT: StatusHint = [{ keys: "Enter", text: "Set" }, { keys: "Escape", text: "Cancel" }]

const RELATIVE_TYPING_HINT: StatusHint = [
  ...TYPING_HINT,
  { text: "Type +50, -20, *2 or /2 to change what's there, =-20 for a negative" }
]

/** Shows the field's hint in the status bar while it is hovered or typed in. */
function useFieldHint(scrubbable: boolean) {
  const owner = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const hint = focused
    ? scrubbable ? RELATIVE_TYPING_HINT : TYPING_HINT
    : hovered && scrubbable
    ? SCRUB_HINT
    : null
  useEffect(() => {
    if (hint === null) return
    showStatusHint(owner, hint)
    return () => clearStatusHint(owner)
  }, [owner, hint])
  return {
    hover: { onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) },
    focus: { onFocus: () => setFocused(true), onBlur: () => setFocused(false) }
  }
}

/**
 * Numeric input that commits on Enter or blur and reverts on Escape or invalid input.
 * With `onScrub`, dragging the field or its label left/right scrubs the value (`step` per pixel,
 * Shift ×10, Alt ×0.1) and commits once on release (`onScrubCommit`, else `onCommit`), so a
 * whole scrub is one undo step; a click selects the text to type over. With `snap`, a scrub lands on multiples of it (and
 * moves faster when the snap is coarse); typed values aren't snapped. A field that scrubs also takes relative entry:
 * `+50`, `-20`, `*2` and `/2` typed over its text act on the value and land on `digits` like a scrub, and `=-20` sets a
 * negative value. Text edited in place is always a plain number, or changing -2790 to -2795 would subtract. A null `value`
 * is mixed (several items that disagree): the input is blank, typing sets them all, a scrub starts from 0, and a
 * relative entry is refused. `format` and `parse` replace plain decimals, for a value that reads as something else (a
 * time of day). While it's hovered or typed in, the status bar says what the mouse and keys do (`useFieldHint`).
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
  readonly handleClassName?: string | undefined
  /** A letter on the handle, e.g. the axis; the handle widens to hold it. */
  readonly handleText?: string
  /** Whether the coloured handle (the scrub grip) is drawn; without it the field is a plain input. */
  readonly handle?: boolean
  /** Shown after the value, e.g. `°`. */
  readonly unit?: string | undefined
  /** The value as text; decimals to `digits` otherwise. */
  readonly format?: ((value: number) => string) | undefined
  /** What's typed as a value, null when it isn't one; a plain number otherwise. */
  readonly parse?: ((text: string) => number | null) | undefined
}) {
  const id = useId()
  const digits = props.digits ?? 3
  const round = (n: number) => Math.round(n * 10 ** digits) / 10 ** digits
  // Text being typed; otherwise the field shows the current value.
  const [draft, setDraft] = useState<string | null>(null)
  const cancelling = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  // Whether the draft was typed over the field's text, not edited in place: only then is it relative entry.
  const typedOver = useRef(false)
  const shown = (value: number) => props.format?.(value) ?? round(value).toFixed(digits)
  const text = draft ?? (props.value === null ? "" : shown(props.value))
  const scrubbable = props.onScrub !== undefined
  const fieldHint = useFieldHint(scrubbable)
  const parse = props.parse ?? ((typed: string) => typed.trim() === "" ? null : Number(typed))
  const commitValue = (n: number | null) => {
    if (n !== null && Number.isFinite(n) && n !== props.value) props.onCommit(n)
  }
  const commitEntry = (typed: string) => {
    const entry = parseNumberEntry(typed)
    if (entry === null) return
    if (entry.kind === "set") commitValue(entry.value)
    else if (props.value !== null) commitValue(round(applyNumberEntry(entry, props.value)))
  }
  const commit = () => {
    if (draft !== null && !cancelling.current) {
      if (scrubbable && props.parse === undefined && typedOver.current) commitEntry(draft)
      else commitValue(parse(draft))
    }
    cancelling.current = false
    typedOver.current = false
    setDraft(null)
  }
  const scrubHandlers = useScrub({
    value: props.value ?? 0,
    step: props.step ?? 1,
    snap: props.snap,
    round,
    onScrub: props.onScrub,
    onCommit: props.onScrubCommit ?? props.onCommit,
    onClick: () => {
      input.current?.focus()
      input.current?.select()
    }
  })
  return (
    <div
      className="flex h-7 min-w-0 overflow-hidden rounded-control border border-border/70 bg-input focus-ring-within dark:bg-input/30"
      {...fieldHint.hover}
    >
      {props.handle !== false && (
        <Label
          htmlFor={id}
          aria-label={props.label}
          className={cn(
            "w-2 shrink-0",
            props.handleClassName ?? "bg-muted",
            props.handleText !== undefined && "w-4 justify-center text-caption text-black select-none",
            scrubbable && "cursor-ew-resize hover:brightness-125"
          )}
          {...scrubHandlers}
        >
          {props.handleText}
        </Label>
      )}
      <Input
        ref={input}
        id={id}
        aria-label={props.handle === false ? props.label : undefined}
        inputMode="decimal"
        className={cn(
          "h-full min-w-0 rounded-none border-0 bg-transparent px-1 py-0 text-right font-mono tabular-nums leading-none focus-visible:outline-none md:leading-none dark:bg-transparent",
          scrubbable && "cursor-ew-resize focus:cursor-text"
        )}
        value={text}
        placeholder={props.value === null ? "Mixed" : undefined}
        {...scrubHandlers}
        onBeforeInput={(e) => {
          const { selectionEnd, selectionStart, value } = e.currentTarget
          if (draft === null) typedOver.current = selectionStart === 0 && selectionEnd === value.length
        }}
        onChange={(e) => {
          if (e.target.value === "") typedOver.current = true
          setDraft(e.target.value)
        }}
        onFocus={fieldHint.focus.onFocus}
        onBlur={() => {
          fieldHint.focus.onBlur()
          commit()
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") {
            cancelling.current = true
            e.currentTarget.blur()
          }
        }}
      />
      {props.unit !== undefined && (
        <span className="flex shrink-0 items-center pr-1 text-caption text-fg-tertiary">{props.unit}</span>
      )}
    </div>
  )
}
