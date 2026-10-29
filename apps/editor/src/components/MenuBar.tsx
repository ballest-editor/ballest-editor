import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger
} from "@workspace/ui/components/menubar"
import type { ReactNode } from "react"
import { formatBinding, type KeybindAction } from "../domain/Keybinds"
import type { Settings } from "../domain/Settings"
import { formatGridSize, GRID_SIZES, type GridSize } from "../domain/snap"
import { updateSettings } from "../editor/actions"
import { actionCommands, type CommandAction } from "../editor/commands"
import { useEditor } from "../editor/store"

/** The action's primary binding, as the menu shows it (nothing when unbound). */
function Shortcut({ action }: { readonly action: KeybindAction }) {
  const binding = useEditor((s) => s.keybinds[action][0])
  return binding === undefined ? null : <MenubarShortcut>{formatBinding(binding)}</MenubarShortcut>
}

/** A menu item that runs the same command as the action's keybind, and shows that keybind. */
function CommandItem(
  { action, disabled = false, inset, children }: {
    readonly action: CommandAction
    readonly disabled?: boolean
    /**
     * Lines the label up with checkbox and radio items in the same menu. Absent otherwise:
     * any `data-inset` attribute, even "false", draws the checkmark gutter.
     */
    readonly inset?: boolean
    readonly children: ReactNode
  }
) {
  return (
    <MenubarItem disabled={disabled} {...(inset && { inset })} onClick={() => actionCommands[action]()}>
      {children}
      <Shortcut action={action} />
    </MenubarItem>
  )
}

/**
 * One top-level menu. A keyboard close returns focus to the menu's title as usual. A
 * pointer close leaves it nowhere, so a later Space or Enter can't reopen the menu and
 * keybinds stay with the viewport; that includes a click on the title, which focuses it.
 */
function Menu({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <MenubarMenu
      onOpenChange={(open, { reason, event }) => {
        if (open || reason !== "trigger-press" || event instanceof KeyboardEvent) return
        requestAnimationFrame(() => {
          const focused = document.activeElement
          if (focused instanceof HTMLElement && focused.closest("[role=menubar]") !== null) focused.blur()
        })
      }}
    >
      <MenubarTrigger className="px-2.5">{title}</MenubarTrigger>
      <MenubarContent className="min-w-40" finalFocus={(closeType) => closeType === "keyboard"}>
        {children}
      </MenubarContent>
    </MenubarMenu>
  )
}

const THEMES: ReadonlyArray<{ readonly theme: Settings["appearance"]["theme"]; readonly label: string }> = [
  { theme: "dark", label: "Dark" },
  { theme: "light", label: "Light" },
  { theme: "system", label: "System" }
]

/**
 * File / Edit / View. Every item calls the entry point its keybind or button
 * uses (`actionCommands`, the store, the settings), so the three never disagree.
 */
export function MenuBar() {
  const canUndo = useEditor((s) => s.past.length > 0 && s.preview === null)
  const canRedo = useEditor((s) => s.future.length > 0 && s.preview === null)
  const hasSelection = useEditor((s) => s.selectedIds.length > 0)
  const openDialog = useEditor((s) => s.openDialog)
  const { snapping, appearance, general } = useEditor((s) => s.settings)

  return (
    <Menubar
      className="h-auto border-none p-0"
      onKeyDown={(e) => {
        // Escape on a closed menu's title leaves the menu bar, handing the keys back to the
        // editor. Keys from an open menu bubble here too (through its portal); they aren't in the bar.
        const { target } = e
        const onClosedTitle = target instanceof HTMLElement && e.currentTarget.contains(target) &&
          target.ariaExpanded !== "true"
        if (e.key === "Escape" && onClosedTitle) target.blur()
      }}
    >
      <Menu title="File">
        <CommandItem action="newMap">New map…</CommandItem>
        <CommandItem action="importMap">Import…</CommandItem>
        <CommandItem action="exportMap">Export…</CommandItem>
      </Menu>
      <Menu title="Edit">
        <CommandItem action="undo" disabled={!canUndo}>Undo</CommandItem>
        <CommandItem action="redo" disabled={!canRedo}>Redo</CommandItem>
        <MenubarSeparator />
        <CommandItem action="duplicateSelection" disabled={!hasSelection}>Duplicate</CommandItem>
        <CommandItem action="deleteSelection" disabled={!hasSelection}>Delete</CommandItem>
        <CommandItem action="deselect" disabled={!hasSelection}>Deselect</CommandItem>
        <MenubarSeparator />
        <MenubarItem onClick={() => openDialog("settings")}>Settings…</MenubarItem>
      </Menu>
      <Menu title="View">
        <CommandItem action="focusSelection" disabled={!hasSelection} inset>Focus selection</CommandItem>
        <MenubarSeparator />
        <MenubarCheckboxItem
          closeOnClick
          checked={appearance.gridVisible}
          onCheckedChange={(gridVisible) => void updateSettings("appearance", { gridVisible })}
        >
          Show grid
        </MenubarCheckboxItem>
        <MenubarCheckboxItem
          closeOnClick
          checked={snapping.enabled}
          onCheckedChange={(enabled) => void updateSettings("snapping", { enabled })}
        >
          Snap to grid
        </MenubarCheckboxItem>
        <MenubarSub>
          <MenubarSubTrigger inset>Grid size</MenubarSubTrigger>
          <MenubarSubContent>
            <MenubarRadioGroup
              value={snapping.gridSize}
              onValueChange={(gridSize: GridSize) => void updateSettings("snapping", { enabled: true, gridSize })}
            >
              {GRID_SIZES.map((size) => (
                <MenubarRadioItem closeOnClick key={size} value={size} className="tabular-nums">
                  {formatGridSize(size, general.units)}
                </MenubarRadioItem>
              ))}
            </MenubarRadioGroup>
          </MenubarSubContent>
        </MenubarSub>
        <MenubarSeparator />
        <MenubarSub>
          <MenubarSubTrigger inset>Theme</MenubarSubTrigger>
          <MenubarSubContent>
            <MenubarRadioGroup
              value={appearance.theme}
              onValueChange={(theme: Settings["appearance"]["theme"]) => void updateSettings("appearance", { theme })}
            >
              {THEMES.map(({ theme, label }) => (
                <MenubarRadioItem closeOnClick key={theme} value={theme}>{label}</MenubarRadioItem>
              ))}
            </MenubarRadioGroup>
          </MenubarSubContent>
        </MenubarSub>
      </Menu>
    </Menubar>
  )
}
