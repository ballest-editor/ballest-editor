import { Kbd } from "@workspace/ui/components/kbd"
import { cn } from "@workspace/ui/lib/utils"
import { Fragment } from "react"
import { formatBinding } from "../domain/Keybinds"
import { MouseButtonIcon } from "./MouseButtonIcon"

const MOUSE_BUTTONS: Readonly<Record<string, "left" | "right">> = { Mouse0: "left", Mouse2: "right" }

/** A chord's text as the app shows it everywhere: "Ctrl + S", the left and right mouse buttons as icons. */
export function ChordText({ binding }: { readonly binding: string }) {
  return binding.split("+").map((part, index) => {
    const button = MOUSE_BUTTONS[part]
    return (
      <Fragment key={part}>
        {index > 0 && " + "}
        {button === undefined ? formatBinding(part) : <MouseButtonIcon button={button} className="size-3.5" />}
      </Fragment>
    )
  })
}

/** One chord as a caption chip. It's a hint, not a control, so it takes no pointer events; `KeybindControl` is the control. */
export function KeyChip({ binding, className }: { readonly binding: string; readonly className?: string }) {
  return (
    <Kbd className={cn("rounded-full px-1.5 text-fg-tertiary", className)}>
      <ChordText binding={binding} />
    </Kbd>
  )
}

/** The Shift + mouse-button chord shown next to a shortcut. */
export const ShiftClick = ({ button }: { readonly button: "left" | "right" }) => (
  <KeyChip binding={button === "left" ? "Shift+Mouse0" : "Shift+Mouse2"} className="justify-self-end" />
)
