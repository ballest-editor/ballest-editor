import { IconPlus, IconX } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useMemo, useState } from "react"
import {
  type Bindings,
  chordOf,
  conflictingBindings,
  formatBinding,
  type KeybindAction,
  keybindActionLabels,
  mouseChordOf,
  uniqueBindings,
  wheelChordOf
} from "../domain/Keybinds"
import { saveKeybinds } from "../editor/actions"
import { useEditor } from "../editor/store"
import { ChordText } from "./KeyChip"

/** A binding being captured: a fresh slot (`index` = bindings.length) or a replacement. */
interface Listening {
  readonly action: KeybindAction
  readonly index: number
}

/** Trims the line box to the glyphs' cap height (Chrome 133+); older engines fall back to leading-none. */
const CAP_TEXT = "leading-none [text-box:trim-both_cap_alphabetic]"

/** A + cap that takes no room until its row is hovered; a keyboard reaches it all the same. */
const ADD_ON_HOVER =
  "-ml-1 w-0 overflow-hidden opacity-0 transition-[width,margin,opacity] group-hover/keybind:ml-0 group-hover/keybind:w-6 group-hover/keybind:opacity-100 focus-visible:ml-0 focus-visible:w-6 focus-visible:opacity-100"

/** Shown in place of the cap being (re)bound: same shape, the selection's wash, blinking caret. */
function CaptureCap() {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-primary/12 px-2.5 text-caption text-foreground">
      <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
      <span className={CAP_TEXT}>Press a key</span>
    </span>
  )
}

/**
 * An action's bindings as key caps (hover or focus one to reveal its ×, which slides in), then a
 * + cap to add one, after the word Unbound when there are none, and a capture cap while
 * listening. Caps bound to more than one action of the same kind are marked red.
 */
function KeybindControl(props: {
  readonly action: KeybindAction
  readonly bindings: Bindings
  readonly conflicts: ReadonlySet<string>
  readonly listening: number | null
  readonly onListen: (index: number) => void
  readonly onRemove: (index: number) => void
  /** Keyboard shortcuts' rows: tighter, and beside a bound action the + cap waits for its `group/keybind` to be hovered. */
  readonly compact: boolean
}) {
  const label = keybindActionLabels[props.action]
  const unbound = props.bindings.length === 0
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-1", props.compact ? "min-h-6" : "min-h-7")}>
      {props.bindings.map((binding, index) =>
        props.listening === index
          ? <CaptureCap key="capture" />
          : (
            <span
              key={binding}
              className={cn(
                "group/cap inline-flex h-6 items-stretch overflow-hidden rounded-full text-caption leading-none tabular-nums",
                props.conflicts.has(binding) ? "bg-destructive/15 text-destructive" : "bg-muted text-foreground"
              )}
              title={props.conflicts.has(binding) ? "Also bound to another action" : undefined}
            >
              <button
                type="button"
                className="flex cursor-pointer items-center justify-center px-2.5 transition-colors duration-150 ease-out hover:bg-foreground/10"
                onClick={() => props.onListen(index)}
                aria-label={`Rebind ${label} (${formatBinding(binding)})`}
              >
                <span className={cn(CAP_TEXT, "inline-flex items-center gap-1 whitespace-pre")}>
                  <ChordText binding={binding} />
                </span>
              </button>
              <button
                type="button"
                className="flex w-0 items-center justify-center overflow-hidden text-fg-secondary transition-[width,background-color,color] duration-150 ease-out group-focus-within/cap:w-5 group-hover/cap:w-5 hover:bg-destructive/15 hover:text-destructive"
                onClick={() => props.onRemove(index)}
                aria-label={`Unbind ${formatBinding(binding)} from ${label}`}
              >
                <IconX className="size-3 shrink-0" />
              </button>
            </span>
          )
      )}
      {props.listening === props.bindings.length
        ? <CaptureCap />
        : (
          <>
            {unbound && <span className="px-1 text-caption text-fg-tertiary">Unbound</span>}
            <button
              type="button"
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-fg-secondary transition-colors duration-150 ease-out hover:bg-foreground/10 hover:text-foreground",
                props.compact && !unbound && ADD_ON_HOVER
              )}
              onClick={() => props.onListen(props.bindings.length)}
              aria-label={unbound ? `Bind ${label}` : `Add a binding for ${label}`}
            >
              <IconPlus className="size-3" />
            </button>
          </>
        )}
    </div>
  )
}

/**
 * A press that fills a slot ends the capture, and its listeners with it, before the button comes up. What's left of the
 * press mustn't act on what's under the pointer: on the backdrop, its click would close the dialog.
 */
const swallowRestOfPress = () => {
  const swallow = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const onUp = (e: Event) => {
    swallow(e)
    window.removeEventListener("mouseup", onUp, { capture: true })
    // Only the main button makes a click, and it comes straight after the mouseup.
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }))
  }
  window.addEventListener("mouseup", onUp, { capture: true })
  window.addEventListener("click", swallow, { capture: true })
}

/**
 * Rebinding, as Settings › Keybinds and Keyboard shortcuts both do it: `controlFor` is an action's caps, and one capture
 * runs at a time. Its dialog stays open while `capturing`. The bindings are the store's, so the two never disagree.
 */
export const useKeybindCapture = () => {
  const keybinds = useEditor((s) => s.keybinds)
  const [listening, setListening] = useState<Listening | null>(null)
  const conflicts = useMemo(() => conflictingBindings(keybinds), [keybinds])

  const setBindings = (action: KeybindAction, bindings: Bindings) =>
    void saveKeybinds({ ...keybinds, [action]: uniqueBindings(bindings) })

  // Capturing: the next key, mouse button or wheel step fills the slot (Esc cancels).
  useEffect(() => {
    if (listening === null) return
    const { action, index } = listening
    const assign = (binding: string) => {
      const next = [...keybinds[action]]
      next[index] = binding
      setListening(null)
      void saveKeybinds({ ...keybinds, [action]: uniqueBindings(next) })
    }
    const stop = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    const onKey = (e: KeyboardEvent) => {
      stop(e)
      if (e.code === "Escape") setListening(null)
      else assign(chordOf(e))
    }
    const onMouse = (e: MouseEvent) => {
      stop(e)
      swallowRestOfPress()
      assign(mouseChordOf(e))
    }
    const onWheel = (e: WheelEvent) => {
      stop(e)
      assign(wheelChordOf(e))
    }
    window.addEventListener("keydown", onKey, { capture: true })
    window.addEventListener("mousedown", onMouse, { capture: true })
    window.addEventListener("mouseup", stop, { capture: true })
    window.addEventListener("click", stop, { capture: true })
    window.addEventListener("contextmenu", stop, { capture: true })
    window.addEventListener("wheel", onWheel, { capture: true, passive: false })
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true })
      window.removeEventListener("mousedown", onMouse, { capture: true })
      window.removeEventListener("mouseup", stop, { capture: true })
      window.removeEventListener("click", stop, { capture: true })
      window.removeEventListener("contextmenu", stop, { capture: true })
      window.removeEventListener("wheel", onWheel, { capture: true })
    }
  }, [listening, keybinds])

  const controlFor = (action: KeybindAction, compact = false) => (
    <KeybindControl
      action={action}
      bindings={keybinds[action]}
      conflicts={conflicts}
      listening={listening?.action === action ? listening.index : null}
      onListen={(index) => setListening({ action, index })}
      onRemove={(index) => setBindings(action, keybinds[action].filter((_, i) => i !== index))}
      compact={compact}
    />
  )

  return { capturing: listening !== null, controlFor, setBindings }
}
