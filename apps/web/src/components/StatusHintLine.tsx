import { useStatusHint } from "../editor/statusHint"
import { KeyChip } from "./KeyChip"

/** The status bar's hint for the control under the pointer (editor/statusHint); null with none. */
export function StatusHintLine() {
  const hint = useStatusHint((s) => s.hint)
  if (hint === null) return null
  return (
    <span className="flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap text-fg-secondary">
      {hint.map((item) => (
        <span key={`${item.keys ?? ""}/${item.text}`} className="flex shrink-0 items-center gap-1">
          {item.keys !== undefined && <KeyChip binding={item.keys} />}
          {item.text}
        </span>
      ))}
    </span>
  )
}
