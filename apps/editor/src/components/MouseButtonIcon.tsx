import { IconArrowBigUp } from "@tabler/icons-react"
import { Kbd } from "@workspace/ui/components/kbd"

/** A mouse with its left or right button filled, sized like a Tabler icon (stroke = currentColor). */
export function MouseButtonIcon(props: { readonly button: "left" | "right"; readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-label={`${props.button} click`}
      role="img"
    >
      {/* the pressed button: one half of the top section, filled */}
      <path
        d={props.button === "left" ? "M11 4.1V11H5V9a6 6 0 0 1 6-4.9Z" : "M13 4.1V11h6V9a6 6 0 0 0-6-4.9Z"}
        fill="currentColor"
        stroke="none"
      />
      <rect x="5" y="3" width="14" height="19" rx="7" />
      <path d="M12 3v8M5 11h14" />
    </svg>
  )
}

/** The Shift + mouse-button chord shown next to a shortcut. */
export const ShiftClick = ({ button }: { readonly button: "left" | "right" }) => (
  <Kbd className="justify-self-end gap-0.5">
    <IconArrowBigUp className="size-3.5" />
    <MouseButtonIcon button={button} className="size-3.5" />
  </Kbd>
)
