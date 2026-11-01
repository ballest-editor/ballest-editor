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
import { mapLabelOf } from "../domain/factory"
import { formatBinding, type KeybindAction } from "../domain/Keybinds"
import type { Settings } from "../domain/Settings"
import { formatGridSize, GRID_SIZES, type GridSize } from "../domain/snap"
import {
  chooseProject,
  closeMapTab,
  exportToGame,
  launchGame,
  openProjectMap,
  revealProject,
  setExportOnSave,
  switchProject,
  updateSettings
} from "../editor/actions"
import { actionCommands, type CommandAction } from "../editor/commands"
import { useEditor } from "../editor/store"

/** The action's primary binding, as the menu shows it (nothing when unbound). */
function Shortcut({ action }: { readonly action: KeybindAction }) {
  const binding = useEditor((s) => s.keybinds[action][0])
  return binding === undefined ? null : <MenubarShortcut className="pl-6">{formatBinding(binding)}</MenubarShortcut>
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
      {/* Sized to the longest row (label and shortcut on one line), not to the menu's title. */}
      <MenubarContent className="w-max min-w-40" finalFocus={(closeType) => closeType === "keyboard"}>
        {children}
      </MenubarContent>
    </MenubarMenu>
  )
}

/** Desktop only: the project's maps, most recently changed first (the path is the tooltip). */
function OpenMapMenu() {
  const maps = useEditor((s) => s.projectMaps)
  const open = useEditor((s) => s.file?.name ?? null)
  return (
    <MenubarSub>
      <MenubarSubTrigger disabled={maps.length === 0}>Open map</MenubarSubTrigger>
      <MenubarSubContent className="w-max max-w-96">
        {maps.map((map) => (
          <MenubarItem
            key={map.fileName}
            title={map.path}
            disabled={map.fileName === open}
            onClick={() => openProjectMap(map.fileName)}
          >
            <span className="truncate">{mapLabelOf(map.fileName)}</span>
          </MenubarItem>
        ))}
      </MenubarSubContent>
    </MenubarSub>
  )
}

/** Desktop only: the projects used before, by name (the folder is the tooltip). */
function RecentProjectsMenu() {
  const recent = useEditor((s) => s.project?.recent ?? [])
  return (
    <MenubarSub>
      <MenubarSubTrigger disabled={recent.length === 0}>Recent projects</MenubarSubTrigger>
      <MenubarSubContent className="w-max max-w-96">
        {recent.map((project) => (
          <MenubarItem
            key={project.path}
            title={project.path}
            onClick={() => void switchProject(project.path)}
          >
            <span className="truncate">{project.name}{project.isDefault ? " (default)" : ""}</span>
          </MenubarItem>
        ))}
      </MenubarSubContent>
    </MenubarSub>
  )
}

const THEMES: ReadonlyArray<{ readonly theme: Settings["appearance"]["theme"]; readonly label: string }> = [
  { theme: "dark", label: "Dark" },
  { theme: "light", label: "Light" },
  { theme: "system", label: "System" }
]

/**
 * File / Edit / View / Map, and Game on desktop. The menus use the three nouns of docs/PROJECTS.md: a project holds
 * maps, a map is exported to the game. Every item calls the entry point its keybind or button
 * uses (`actionCommands`, the store, the settings), so the three never disagree.
 */
export function MenuBar() {
  const canUndo = useEditor((s) => s.past.length > 0 && s.preview === null)
  const canRedo = useEditor((s) => s.future.length > 0 && s.preview === null)
  const hasSelection = useEditor((s) => s.selectedIds.length > 0)
  const canPaste = useEditor((s) => s.clipboard !== null)
  const openDialog = useEditor((s) => s.openDialog)
  const { snapping, appearance, lighting, general } = useEditor((s) => s.settings)
  const { projects, exportToGame: canExport, launchGame: canLaunchGame, play: canPlay } = useEditor((s) =>
    s.capabilities
  )
  const hasFile = useEditor((s) => s.file !== null)
  const exportOnSave = useEditor((s) => s.exportOnSave)
  const mapOpen = useEditor((s) => s.mapOpen)
  // the Edit and View commands act on the map in front; Start may cover it
  const onMap = useEditor((s) => s.activeTab === "map")
  const showStart = useEditor((s) => s.showStart)

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
      {projects
        ? (
          <Menu title="File">
            <CommandItem action="newMap">New map…</CommandItem>
            <OpenMapMenu />
            <CommandItem action="openMap">Import…</CommandItem>
            <MenubarSeparator />
            <CommandItem action="saveMap" disabled={!mapOpen}>Save</CommandItem>
            <MenubarItem disabled={!mapOpen} onClick={() => void closeMapTab()}>Close map</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => void chooseProject()}>Choose project folder…</MenubarItem>
            <RecentProjectsMenu />
            <MenubarItem onClick={() => void revealProject()}>Show project folder</MenubarItem>
          </Menu>
        )
        : (
          <Menu title="File">
            <CommandItem action="newMap">New map…</CommandItem>
            <CommandItem action="openMap">Open…</CommandItem>
            <MenubarSeparator />
            <CommandItem action="saveMap" disabled={!mapOpen}>Save</CommandItem>
            <CommandItem action="saveMapAs" disabled={!mapOpen}>Export…</CommandItem>
            <MenubarItem disabled={!mapOpen} onClick={() => void closeMapTab()}>Close map</MenubarItem>
          </Menu>
        )}
      <Menu title="Edit">
        <CommandItem action="undo" disabled={!onMap || !canUndo}>Undo</CommandItem>
        <CommandItem action="redo" disabled={!onMap || !canRedo}>Redo</CommandItem>
        <MenubarSeparator />
        <CommandItem action="cutSelection" disabled={!onMap || !hasSelection}>Cut</CommandItem>
        <CommandItem action="copySelection" disabled={!onMap || !hasSelection}>Copy</CommandItem>
        <CommandItem action="paste" disabled={!onMap || !canPaste}>Paste</CommandItem>
        <CommandItem action="duplicateSelection" disabled={!onMap || !hasSelection}>Duplicate</CommandItem>
        <CommandItem action="deleteSelection" disabled={!onMap || !hasSelection}>Delete</CommandItem>
        <CommandItem action="deselect" disabled={!onMap || !hasSelection}>Deselect</CommandItem>
        <MenubarSeparator />
        <MenubarItem onClick={() => openDialog("settings")}>Settings…</MenubarItem>
      </Menu>
      <Menu title="View">
        <MenubarItem inset onClick={showStart}>Start</MenubarItem>
        <CommandItem action="focusSelection" disabled={!onMap || !hasSelection} inset>Focus selection</CommandItem>
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
        <MenubarCheckboxItem
          closeOnClick
          checked={lighting.mapLighting}
          onCheckedChange={(mapLighting) => void updateSettings("lighting", { mapLighting })}
        >
          Map lighting
        </MenubarCheckboxItem>
        <MenubarCheckboxItem
          closeOnClick
          checked={lighting.skyVisible}
          onCheckedChange={(skyVisible) => void updateSettings("lighting", { skyVisible })}
        >
          Show sky
        </MenubarCheckboxItem>
        <MenubarCheckboxItem
          closeOnClick
          checked={appearance.waterVisible}
          onCheckedChange={(waterVisible) => void updateSettings("appearance", { waterVisible })}
        >
          Show water
        </MenubarCheckboxItem>
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
      <Menu title="Map">
        {projects && (
          <>
            <MenubarItem inset disabled={!mapOpen} onClick={() => openDialog(hasFile ? "rename" : "saveAs")}>
              Rename…
            </MenubarItem>
            <CommandItem action="saveMapAs" inset disabled={!mapOpen}>Duplicate…</CommandItem>
            <MenubarItem inset disabled={!mapOpen} onClick={() => openDialog("recover")}>
              Recover previous version…
            </MenubarItem>
          </>
        )}
        <MenubarItem {...(projects && { inset: true })} disabled={!mapOpen} onClick={() => openDialog("mapSettings")}>
          Map settings…
        </MenubarItem>
        {canExport && (
          <>
            <MenubarSeparator />
            <MenubarItem inset disabled={!mapOpen} onClick={() => void exportToGame()}>Export to game</MenubarItem>
            <MenubarCheckboxItem
              closeOnClick
              disabled={!mapOpen}
              checked={exportOnSave}
              onCheckedChange={(on) => void setExportOnSave(on)}
            >
              Export on save
            </MenubarCheckboxItem>
          </>
        )}
      </Menu>
      {canLaunchGame && (
        <Menu title="Game">
          {canPlay && <CommandItem action="playMap" disabled={!mapOpen}>Play</CommandItem>}
          <MenubarItem onClick={() => void launchGame()}>Launch game</MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => openDialog("settings", "game")}>Game folders…</MenubarItem>
        </Menu>
      )}
    </Menubar>
  )
}
