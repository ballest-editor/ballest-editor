import { Button } from "@workspace/ui/components/button"
import { askedOrder, SNAP_TARGET_NAMES } from "../domain/snapConfig"
import { applyFlipOffer, setFlushOptions } from "../editor/actions"
import { snapConfigOf, useEditor } from "../editor/store"
import { NumberField } from "./NumberField"
import { SnapGlyph } from "./SnapGlyph"
import { SURFACE } from "./viewControlStyle"

const CHIP = `pointer-events-auto flex items-center gap-2 rounded-full px-2.5 py-1 text-caption ${SURFACE}`

/** Flush and tangent's small panel: which, and how far apart. */
function FlushPanel() {
  const mode = useEditor((s) => s.flushMode)
  const offset = useEditor((s) => s.flushOffset)
  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant={mode === "flush" ? "secondary" : "ghost"}
        onClick={() => setFlushOptions({ mode: "flush" })}
      >
        Flush
      </Button>
      <Button
        size="sm"
        variant={mode === "tangent" ? "secondary" : "ghost"}
        onClick={() => setFlushOptions({ mode: "tangent" })}
      >
        Tangent
      </Button>
      <div className="w-24">
        <NumberField
          label="Offset"
          value={offset}
          digits={1}
          handle={false}
          unit="cm"
          onCommit={(next) => setFlushOptions({ offset: next })}
        />
      </div>
    </div>
  )
}

/** The target picker's prompt, in the corner of the active pane, with its panel and a way out. */
function PickerPrompt() {
  const picker = useEditor((s) => s.picker)
  const setPicker = useEditor((s) => s.setPicker)
  if (picker === null) return null
  return (
    <div className={CHIP} data-snap-picker>
      <span>{picker.prompt}</span>
      {picker.panel === "flush" && <FlushPanel />}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          picker.onCancel?.()
          setPicker(null)
        }}
      >
        Cancel
      </Button>
    </div>
  )
}

/**
 * What snapped, in the active pane's corner (docs/SNAPPING.md § What a drag looks like): the one place every target
 * reports, with the chip for ends whose profiles differ and the offer of the mirrored twin.
 */
export function SnapLabel() {
  const feedback = useEditor((s) => s.snapFeedback)
  const flipOffer = useEditor((s) => s.flipOffer)
  const setFlipOffer = useEditor((s) => s.setFlipOffer)
  return (
    <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-1">
      <PickerPrompt />
      {feedback !== null && (
        <div className={CHIP} data-snap-label>
          {feedback.relation !== undefined && <SnapGlyph relation={feedback.relation} />}
          <span className="truncate">{feedback.label}</span>
          {feedback.warning !== undefined && <span className="text-destructive">{feedback.warning}</span>}
          {feedback.hint !== undefined && <span className="shrink-0 text-fg-tertiary">{feedback.hint}</span>}
        </div>
      )}
      {flipOffer !== null && (
        <div className={CHIP} data-snap-flip>
          <span>The mirrored twin fits here.</span>
          <Button size="sm" variant="secondary" onClick={applyFlipOffer}>Flip to fit</Button>
          <Button size="sm" variant="ghost" onClick={() => setFlipOffer(null)}>Dismiss</Button>
        </div>
      )}
    </div>
  )
}

/** The status bar's right end while a drag is in progress: the base and what it is on, in the pane's words. */
export function SnapStatus() {
  const feedback = useEditor((s) => s.snapFeedback)
  const first = useEditor((s) => askedOrder(snapConfigOf(s))[0])
  if (feedback === null) return null
  return (
    <span className="min-w-0 truncate text-fg-secondary" data-snap-status>
      {feedback.base} · {first === undefined ? "" : `${SNAP_TARGET_NAMES[first]} first · `}
      {feedback.label}
    </span>
  )
}
