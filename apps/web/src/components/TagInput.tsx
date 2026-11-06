import { IconX } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"
import { type Ref, useState } from "react"
import { CHIP } from "./chipStyle"

/**
 * An item's or a group's tags: free strings as chips with an input under them. Enter, a comma or leaving the field adds
 * what's typed; Backspace in the empty field takes the last chip off. `tags` is the whole new list each time.
 */
export function TagInput({ id, inputRef, tags, onChange }: {
  readonly id?: string
  readonly inputRef?: Ref<HTMLInputElement>
  readonly tags: ReadonlyArray<string>
  readonly onChange: (tags: ReadonlyArray<string>) => void
}) {
  const [draft, setDraft] = useState("")
  const add = () => {
    if (draft.trim().length > 0) onChange([...tags, draft])
    setDraft("")
  }
  return (
    <div className="flex flex-col gap-1">
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Tags">
          {tags.map((tag) => (
            <li key={tag}>
              <Badge className={cn(CHIP, "max-w-full pr-0.5")}>
                <span className="truncate">{tag}</span>
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  className="flex size-4 items-center justify-center rounded-full text-fg-secondary transition-colors focus-ring hover:bg-hover hover:text-foreground active:bg-pressed"
                  onClick={() => onChange(tags.filter((t) => t !== tag))}
                >
                  <IconX className="size-2.5" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Input
        {...(id !== undefined && { id })}
        {...(inputRef !== undefined && { ref: inputRef })}
        value={draft}
        placeholder="Add a tag"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault()
            add()
          } else if (e.key === "Backspace" && draft.length === 0 && tags.length > 0) {
            onChange(tags.slice(0, -1))
          }
        }}
      />
    </div>
  )
}
