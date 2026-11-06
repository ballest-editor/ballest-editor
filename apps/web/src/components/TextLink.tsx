import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

/** A link set in running text: a button in the link's clothes, so a dialog's prose and a row's name can open things. */
export function TextLink({ children, onClick, className }: {
  readonly children: string
  readonly onClick: () => void
  readonly className?: string
}) {
  return (
    <Button
      variant="link"
      className={cn("h-auto max-w-full justify-start truncate border-0 px-0", className)}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
