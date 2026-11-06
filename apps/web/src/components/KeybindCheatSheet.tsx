import { IconSearch } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"
import { type ReactNode, useState } from "react"
import { cheatSheetSections, matchingActions, type NamedAction, namedActions } from "../domain/GameKeybinds"
import { formatBindings, type KeybindAction } from "../domain/Keybinds"
import { useEditor } from "../editor/store"
import { useKeybindCapture } from "./KeybindControl"
import { KeyChip } from "./KeyChip"
import { SectionTitle } from "./SectionTitle"

const TITLE = "Keyboard shortcuts"

/** `named` in three columns, under their sections; `keysOf` is an action's keys. */
function KeybindColumns({ named, keysOf }: {
  readonly named: ReadonlyArray<NamedAction>
  readonly keysOf: (action: KeybindAction) => ReactNode
}) {
  const keybinds = useEditor((s) => s.keybinds)
  return (
    <div className="columns-1 gap-8 sm:columns-2 lg:columns-3">
      {cheatSheetSections(named).map(({ section, actions }) => (
        <section key={section} className="mb-5 break-inside-avoid">
          <SectionTitle>{section}</SectionTitle>
          <dl className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
            {actions.map(({ action, label }) => (
              <div key={action} className="group/keybind contents">
                {/* the game names its actions in lower case; the sheet reads them in sentence case like every other label */}
                <dt
                  className={cn(
                    "whitespace-nowrap first-letter:uppercase",
                    keybinds[action].length === 0 && "text-fg-tertiary"
                  )}
                >
                  {label}
                </dt>
                <dd>{keysOf(action)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

/** What the dialog holds: the filter, then the keybinds it leaves, each rebound in place. */
function FilteredKeybinds({ keysOf }: { readonly keysOf: (action: KeybindAction) => ReactNode }) {
  const keybinds = useEditor((s) => s.keybinds)
  const defaults = useEditor((s) => s.keybindDefaults)
  const [query, setQuery] = useState("")
  const named = matchingActions(namedActions(defaults), keybinds, query)
  return (
    <>
      <div className="relative">
        <IconSearch className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-fg-secondary" />
        <Input
          autoFocus
          className="pl-7"
          placeholder="Filter by action or key"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter shortcuts by action or key"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {/* a fixed height, so the filter stays put while the list under it shrinks */}
      <div className="h-[min(70vh,640px)] overflow-y-auto">
        {named.length === 0
          ? <p className="py-8 text-center text-fg-tertiary">No shortcut matches “{query.trim()}”.</p>
          : <KeybindColumns named={named} keysOf={keysOf} />}
      </div>
    </>
  )
}

/** Help › Keyboard shortcuts: stays until it's closed, and not while a key is being captured. */
function KeybindDialog() {
  const open = useEditor((s) => s.dialog?.id === "keybinds")
  const close = useEditor((s) => s.closeDialog)
  const { capturing, controlFor } = useKeybindCapture()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !capturing && close()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{TITLE}</DialogTitle>
          <DialogDescription>Click a key to rebind it. Settings › Keybinds says what each one does.</DialogDescription>
        </DialogHeader>
        <FilteredKeybinds keysOf={(action) => controlFor(action, true)} />
      </DialogContent>
    </Dialog>
  )
}

/** An action's keys as hints, for the sheet shown while its binding is held. */
function HintKeys({ action }: { readonly action: KeybindAction }) {
  const bindings = useEditor((s) => s.keybinds[action])
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {bindings.length === 0
        ? <span className="text-caption text-fg-tertiary">{formatBindings([])}</span>
        : bindings.map((binding) => <KeyChip key={binding} binding={binding} />)}
    </div>
  )
}

const hintKeysOf = (action: KeybindAction) => <HintKeys action={action} />

/**
 * The keybinds two ways. Help › Keyboard shortcuts opens them as a dialog. While the "keyboard shortcuts" binding is held
 * (Shift+/ by default; useActionKeys shows and hides it) they sit over the editor, read-only and click-through.
 */
export function KeybindCheatSheet() {
  const held = useEditor((s) => s.cheatSheet)
  const defaults = useEditor((s) => s.keybindDefaults)
  return (
    <>
      <KeybindDialog />
      {held && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-8">
          <div className="max-h-full w-full max-w-5xl overflow-hidden rounded-sheet bg-popover/90 p-dialog text-popover-foreground shadow-2xl backdrop-blur-md">
            <h2 className="mb-4 text-title">{TITLE}</h2>
            <KeybindColumns named={namedActions(defaults)} keysOf={hintKeysOf} />
          </div>
        </div>
      )}
    </>
  )
}
