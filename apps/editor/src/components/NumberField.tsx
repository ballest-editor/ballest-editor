import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { useEffect, useId, useState } from "react"

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
  const [text, setText] = useState(format(props.value))
  useEffect(() => setText(format(props.value)), [props.value])
  const commit = () => {
    const n = Number(text)
    if (text.trim() === "" || !Number.isFinite(n)) setText(format(props.value))
    else if (n !== props.value) props.onCommit(n)
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground">{props.label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        className="font-mono"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") {
            setText(format(props.value))
            e.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}
