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
      className={props.className ?? "size-3.5"}
      aria-label={`${props.button} click`}
      role="img"
    >
      <path
        d={props.button === "left" ? "M12 3a6 6 0 0 0-6 6v2h6z" : "M12 3a6 6 0 0 1 6 6v2h-6z"}
        fill="currentColor"
      />
      <rect x="6" y="3" width="12" height="18" rx="6" />
      <path d="M12 3v8M6 11h12" />
    </svg>
  )
}
