import { cn } from "cn"
import * as React from "react"
import { HexColorPicker } from "react-colorful"

import { Input } from "./input"

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i

/** `#abc` / `abc` / `#aabbcc` as lowercase `#aabbcc`; undefined when it isn't a hex colour. */
function normalizeHex(text: string): string | undefined {
  const digits = HEX.exec(text.trim())?.[1]?.toLowerCase()
  if (digits === undefined) return undefined
  return `#${digits.length === 3 ? digits.replace(/./g, "$&$&") : digits}`
}

/**
 * A saturation/hue picker with a hex field. `onChange` gets every value while the pointer
 * (or an arrow key) moves; `onCommit` gets the final one when it's released, and the hex
 * field's value on Enter or blur.
 */
function ColorPicker({
  value,
  onChange,
  onCommit,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "onChange"> & {
  readonly value: string
  readonly onChange?: (hex: string) => void
  readonly onCommit: (hex: string) => void
}) {
  const [live, setLive] = React.useState<string | null>(null)
  const [text, setText] = React.useState<string | null>(null)
  const shown = live ?? value
  // The colour being dragged to; committed when the pointer is released anywhere.
  const dragged = React.useRef<string | null>(null)
  const listening = React.useRef<AbortController | null>(null)
  const finish = () => {
    listening.current?.abort()
    listening.current = null
    const hex = dragged.current
    dragged.current = null
    setLive(null)
    if (hex !== null && hex !== value) onCommit(hex)
  }
  // The window listeners call the latest render's `finish`, not the one from pointer-down.
  const latestFinish = React.useRef(finish)
  React.useEffect(() => {
    latestFinish.current = finish
  })
  React.useEffect(() => () => listening.current?.abort(), [])
  const start = () => {
    listening.current?.abort()
    const controller = new AbortController()
    listening.current = controller
    for (const type of ["pointerup", "pointercancel"]) {
      window.addEventListener(type, () => latestFinish.current(), { signal: controller.signal })
    }
  }
  const commitText = () => {
    const hex = text === null ? undefined : normalizeHex(text)
    setText(null)
    if (hex !== undefined && hex !== value) onCommit(hex)
  }

  return (
    <div
      data-slot="color-picker"
      className={cn(
        "flex flex-col gap-2 [&_.react-colorful]:h-40 [&_.react-colorful]:w-full [&_.react-colorful]:gap-2 [&_.react-colorful__hue]:h-3 [&_.react-colorful__hue]:rounded-full [&_.react-colorful__last-control]:rounded-full [&_.react-colorful__pointer]:size-4 [&_.react-colorful__pointer]:border-2 [&_.react-colorful__pointer]:shadow-sm [&_.react-colorful__saturation]:rounded-md [&_.react-colorful__saturation]:border-b-0",
        className
      )}
      onPointerDown={start}
      onKeyUp={(e) => {
        if (e.key.startsWith("Arrow")) finish()
      }}
      {...props}
    >
      <HexColorPicker
        color={shown}
        onChange={(hex) => {
          dragged.current = hex
          setLive(hex)
          onChange?.(hex)
        }}
      />
      <Input
        aria-label="Hex colour"
        className="font-mono"
        spellCheck={false}
        value={text ?? shown}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") setText(null)
        }}
      />
    </div>
  )
}

/** A colour chip; a null colour (several values that differ) is drawn as a checkerboard. */
function ColorSwatch({
  color,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "color"> & { readonly color: string | null }) {
  return (
    <span
      data-slot="color-swatch"
      className={cn(
        "inline-block size-4 shrink-0 rounded-sm ring-1 ring-foreground/20",
        color === null && "bg-[repeating-conic-gradient(var(--muted)_0_25%,var(--background)_0_50%)] bg-size-[8px_8px]",
        className
      )}
      style={color === null ? undefined : { backgroundColor: color }}
      {...props}
    />
  )
}

export { ColorPicker, ColorSwatch, normalizeHex }
