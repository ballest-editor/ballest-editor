import { Kbd } from "@workspace/ui/components/kbd"
import { cn } from "@workspace/ui/lib/utils"
import { type NamedAction, namedActions } from "../domain/GameKeybinds"
import { formatBinding, formatBindings } from "../domain/Keybinds"
import { useEditor } from "../editor/store"

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
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/40 p-8">
      <div className="max-h-full w-full max-w-5xl overflow-hidden rounded-xl border border-border/60 bg-background/85 p-5 shadow-2xl backdrop-blur-md">
        <h2 className="mb-3 text-sm font-medium">Keybinds</h2>
        <div className="columns-1 gap-8 sm:columns-2 lg:columns-3">
          {bySection(namedActions(defaults)).map(({ section, actions }) => (
            <section key={section} className="mb-4 break-inside-avoid">
              <h3 className="mb-1 text-[0.65rem] font-semibold tracking-wider text-muted-foreground uppercase">
                {section}
              </h3>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
                {actions.map(({ action, label }) => (
                  <div key={action} className="contents">
                    <dt className={cn("font-medium", keybinds[action].length === 0 && "text-muted-foreground")}>
                      {label}
                    </dt>
                    <dd className="flex flex-wrap justify-end gap-1">
                      {keybinds[action].length === 0
                        ? <span className="text-muted-foreground">{formatBindings([])}</span>
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
