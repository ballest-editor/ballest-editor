import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { useId, useRef, useState } from "react"

/** Numeric input that commits on Enter or blur and reverts on Escape or invalid input. */
export function NumberField(props: {
  readonly label: string
  readonly value: number
  readonly onCommit: (value: number) => void
  readonly digits?: number
}) {
  const id = useId()
  const digits = props.digits ?? 3
  const format = (n: number) => String(Math.round(n * 10 ** digits) / 10 ** digits)
  // Text being typed; otherwise the field shows the current value.
  const [draft, setDraft] = useState<string | null>(null)
  const cancelling = useRef(false)
  const text = draft ?? format(props.value)
  const commit = () => {
    const n = Number(draft)
    const valid = draft !== null && draft.trim() !== "" && Number.isFinite(n)
    if (valid && !cancelling.current && n !== props.value) props.onCommit(n)
    cancelling.current = false
    setDraft(null)
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground">{props.label}</Label>
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
