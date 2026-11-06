import { Kbd } from "@workspace/ui/components/kbd"
import { cn } from "@workspace/ui/lib/utils"
import { type NamedAction, namedActions } from "../domain/GameKeybinds"
import { formatBinding, formatBindings } from "../domain/Keybinds"
import { useEditor } from "../editor/store"
import { SectionTitle } from "./SectionTitle"

/** Consecutive actions grouped under their section (namedActions is already sorted by section). */
const bySection = (actions: ReadonlyArray<NamedAction>) => {
  const groups: Array<{ section: string; actions: Array<NamedAction> }> = []
  for (const named of actions) {
    const last = groups.at(-1)
    if (last?.section === named.section) last.actions.push(named)
    else groups.push({ section: named.section, actions: [named] })
  }
  return groups
}

/**
 * Every current keybind, shown over the editor while the "keybind cheat sheet" binding is
 * held (Shift+/ by default; useActionKeys shows and hides it). Read-only and click-through.
 */
export function KeybindCheatSheet() {
  const open = useEditor((s) => s.cheatSheet)
  const keybinds = useEditor((s) => s.keybinds)
  const defaults = useEditor((s) => s.keybindDefaults)
  if (!open) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-8">
      <div className="max-h-full w-full max-w-5xl overflow-hidden rounded-surface bg-popover/90 p-6 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-md">
        <h2 className="mb-4 text-title">Keybinds</h2>
        <div className="columns-1 gap-8 sm:columns-2 lg:columns-3">
          {bySection(namedActions(defaults)).map(({ section, actions }) => (
            <section key={section} className="mb-5 break-inside-avoid">
              <SectionTitle>{section}</SectionTitle>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-body">
                {actions.map(({ action, label }) => (
                  <div key={action} className="contents">
                    {/* the game names its actions in lower case; the sheet reads them in sentence case like every other label */}
                    <dt
                      className={cn(
                        "first-letter:uppercase",
                        keybinds[action].length === 0 && "text-fg-tertiary"
                      )}
                    >
                      {label}
                    </dt>
                    <dd className="flex flex-wrap justify-end gap-1">
                      {keybinds[action].length === 0
                        ? <span className="text-fg-tertiary">{formatBindings([])}</span>
                        : keybinds[action].map((binding) => <Kbd key={binding}>{formatBinding(binding)}</Kbd>)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
