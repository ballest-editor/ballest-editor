import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"
import { cheatSheetSections, namedActions } from "../domain/GameKeybinds"
import { formatBindings } from "../domain/Keybinds"
import { useEditor } from "../editor/store"
import { KeyChip } from "./KeyChip"
import { SectionTitle } from "./SectionTitle"

const TITLE = "Keyboard shortcuts"

/** Every current keybind in three columns, under its section. */
function KeybindColumns() {
  const keybinds = useEditor((s) => s.keybinds)
  const defaults = useEditor((s) => s.keybindDefaults)
  return (
    <div className="columns-1 gap-8 sm:columns-2 lg:columns-3">
      {cheatSheetSections(namedActions(defaults)).map(({ section, actions }) => (
        <section key={section} className="mb-5 break-inside-avoid">
          <SectionTitle>{section}</SectionTitle>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            {actions.map(({ action, label }) => (
              <div key={action} className="contents">
                {/* the game names its actions in lower case; the sheet reads them in sentence case like every other label */}
                <dt className={cn("first-letter:uppercase", keybinds[action].length === 0 && "text-fg-tertiary")}>
                  {label}
                </dt>
                <dd className="flex flex-wrap justify-end gap-1">
                  {keybinds[action].length === 0
                    ? <span className="text-caption text-fg-tertiary">{formatBindings([])}</span>
                    : keybinds[action].map((binding) => <KeyChip key={binding} binding={binding} />)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

/**
 * The keybinds two ways. Help › Keyboard shortcuts opens them as a dialog that stays until it's closed. While the "keyboard
 * shortcuts" binding is held (Shift+/ by default; useActionKeys shows and hides it) they sit over the editor,
 * read-only and click-through.
 */
export function KeybindCheatSheet() {
  const held = useEditor((s) => s.cheatSheet)
  const open = useEditor((s) => s.dialog?.id === "keybinds")
  const close = useEditor((s) => s.closeDialog)
  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{TITLE}</DialogTitle>
            <DialogDescription>Change them in Settings › Keybinds.</DialogDescription>
          </DialogHeader>
          <KeybindColumns />
        </DialogContent>
      </Dialog>
      {held && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-8">
          <div className="max-h-full w-full max-w-5xl overflow-hidden rounded-surface bg-popover/90 p-dialog text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-md">
            <h2 className="mb-4 text-title">{TITLE}</h2>
            <KeybindColumns />
          </div>
        </div>
      )}
    </>
  )
}
