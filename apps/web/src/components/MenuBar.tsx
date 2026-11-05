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
import { canCheckForUpdates } from "../domain/updates"
import {
  checkForUpdates,
  chooseProject,
  exportToGame,
  launchGame,
  quitApp,
  reimportMap,
  setExportOnSave,
  switchProject,
  updateSettings
} from "../editor/actions"
import { actionCommands, type CommandAction } from "../editor/commands"
import { useEditor, useOpenProjectMap } from "../editor/store"
import { openSettings, resetDockLayout, togglePanel, usePanelOpen, useViewMenuPanels } from "./dock/dockControl"

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

/**
 * Desktop only: the projects used before, by name (the folder is the tooltip). One open in another window says so, and
 * picking it still gets main's refusal, which says what to do.
 */
function RecentProjectsMenu() {
  const state = useEditor((s) => s.project)
  const recent = state?.recent ?? []
  const openElsewhere = state?.openElsewhere ?? []
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
            <span className="truncate">{project.name}</span>
            {openElsewhere.includes(project.path) && (
              <span className="shrink-0 pl-4 text-muted-foreground">Open in another window</span>
            )}
          </MenubarItem>
        ))}
      </MenubarSubContent>
    </MenubarSub>
  )
}

function PanelItem({ id, title }: { readonly id: string; readonly title: string }) {
  const open = usePanelOpen(id)
  return (
    <MenubarCheckboxItem closeOnClick checked={open} onCheckedChange={() => togglePanel(id)}>
      {title}
    </MenubarCheckboxItem>
  )
}

const THEMES: ReadonlyArray<{ readonly theme: Settings["appearance"]["theme"]; readonly label: string }> = [
  { theme: "dark", label: "Dark" },
  { theme: "light", label: "Light" },
  { theme: "system", label: "System" }
]

/**
 * File / Edit / View / Project (docs/PROJECTS.md § Shell). The menus use the three nouns of docs/PROJECTS.md: a
 * project holds maps, a map is exported to the game; a map is only ever the open one, and the game is the project's
 * export target, so there is no Map or Game menu. Every item calls the entry point its keybind or button uses
 * (`actionCommands`, the store, the settings), so the three never disagree. A browser, which has no project, gets
 * File = New map, Open, Save, Export (a download) and Project = Project settings (the one map's).
 */
export function MenuBar() {
  const canUndo = useEditor((s) => s.past.length > 0 && s.preview === null)
  const canCheck = useEditor((s) => s.update !== null && canCheckForUpdates(s.update))
  const canRedo = useEditor((s) => s.future.length > 0 && s.preview === null)
  const hasSelection = useEditor((s) => s.selectedIds.length > 0)
  const canPaste = useEditor((s) => s.clipboard !== null)
  const openDialog = useEditor((s) => s.openDialog)
  const viewMenuPanels = useViewMenuPanels()
  const { snapping, appearance, lighting, general } = useEditor((s) => s.settings)
  const { projects, exportToGame: canExport, launchGame: canLaunchGame, play: canPlay } = useEditor((s) =>
    s.capabilities
  )
  const exportOnSave = useEditor((s) => s.exportOnSave)
  // Untitled Project has no folder to import into yet (the Project panel's Import is disabled the same way)
  const untitled = useEditor((s) => s.project?.current === null)
  // Re-import needs an export to take the map from
  const exportedFile = useOpenProjectMap()?.map
  const reimportable = exportedFile?.link?.export != null ? exportedFile.fileName : null

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
            <MenubarItem onClick={() => openDialog({ id: "newProject" })}>New project…</MenubarItem>
            <MenubarItem onClick={() => void chooseProject()}>Open project…</MenubarItem>
            <RecentProjectsMenu />
            <MenubarSeparator />
            <CommandItem action="saveMap">Save</CommandItem>
            <CommandItem action="closeTab">Close tab</CommandItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => openSettings()}>Settings…</MenubarItem>
            <MenubarItem onClick={() => openDialog({ id: "gameLink" })}>Game link…</MenubarItem>
            <MenubarItem disabled={!canCheck} onClick={() => void checkForUpdates()}>Check for updates</MenubarItem>
            <MenubarItem onClick={() => void quitApp()}>Quit</MenubarItem>
          </Menu>
        )
        : (
          <Menu title="File">
            <CommandItem action="newMap">New map…</CommandItem>
            <CommandItem action="openMap">Open…</CommandItem>
            <MenubarSeparator />
            <CommandItem action="saveMap">Save</CommandItem>
            <CommandItem action="saveMapAs">Export…</CommandItem>
            <CommandItem action="closeTab">Close tab</CommandItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => openSettings()}>Settings…</MenubarItem>
          </Menu>
        )}
      <Menu title="Edit">
        <CommandItem action="undo" disabled={!canUndo}>Undo</CommandItem>
        <CommandItem action="redo" disabled={!canRedo}>Redo</CommandItem>
        <MenubarSeparator />
        <CommandItem action="cutSelection" disabled={!hasSelection}>Cut</CommandItem>
        <CommandItem action="copySelection" disabled={!hasSelection}>Copy</CommandItem>
        <CommandItem action="paste" disabled={!canPaste}>Paste</CommandItem>
        <CommandItem action="duplicateSelection" disabled={!hasSelection}>Duplicate</CommandItem>
        <CommandItem action="deleteSelection" disabled={!hasSelection}>Delete</CommandItem>
        <CommandItem action="deselect" disabled={!hasSelection}>Deselect</CommandItem>
      </Menu>
      <Menu title="View">
        <CommandItem action="focusSelection" disabled={!hasSelection} inset>Focus selection</CommandItem>
        <MenubarSeparator />
        {viewMenuPanels.map(({ id, title }) => <PanelItem key={id} id={id} title={title} />)}
        <MenubarItem inset onClick={resetDockLayout}>Reset layout</MenubarItem>
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
      {projects
        ? (
          <Menu title="Project">
            <CommandItem action="newMap" inset>New map…</CommandItem>
            <CommandItem action="openMap" inset disabled={untitled}>Import map…</CommandItem>
            {canExport && (
              <>
                <MenubarSeparator />
                <MenubarItem inset onClick={() => void exportToGame()}>Export to game</MenubarItem>
                <MenubarCheckboxItem
                  closeOnClick
                  checked={exportOnSave}
                  onCheckedChange={(on) => void setExportOnSave(on)}
                >
                  Export on save
                </MenubarCheckboxItem>
                <MenubarItem
                  inset
                  disabled={reimportable === null}
                  onClick={() => reimportable !== null && void reimportMap(reimportable)}
                >
                  Re-import from game
                </MenubarItem>
                {canPlay && <CommandItem action="playMap" inset>Play</CommandItem>}
                {canLaunchGame && <MenubarItem inset onClick={() => void launchGame()}>Launch game</MenubarItem>}
              </>
            )}
            <MenubarSeparator />
            <MenubarItem inset onClick={() => openDialog({ id: "projectSettings" })}>Project settings…</MenubarItem>
          </Menu>
        )
        : (
          <Menu title="Project">
            <MenubarItem onClick={() => openDialog({ id: "mapSettings" })}>Project settings…</MenubarItem>
          </Menu>
        )}
    </Menubar>
  )
}
