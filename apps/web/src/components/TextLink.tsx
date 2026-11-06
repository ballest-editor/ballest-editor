import { Button } from "@workspace/ui/components/button"

/** A link set in running text: a button in the link's clothes, so a dialog's prose and a row's name can open things. */
export function TextLink({ children, onClick }: { readonly children: string; readonly onClick: () => void }) {
  return (
    <Button variant="link" className="h-auto max-w-full justify-start truncate border-0 px-0" onClick={onClick}>
      {children}
    </Button>
  )
}
