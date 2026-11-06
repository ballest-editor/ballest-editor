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
import { type ReactNode, useMemo } from "react"
import { canGroupSelection, selectedGroupIds } from "../domain/groupSelection"
import { formatBinding, type KeybindAction } from "../domain/Keybinds"
import type { Settings } from "../domain/Settings"
import { formatGridSize, GRID_SIZES } from "../domain/snap"
import { canCheckForUpdates } from "../domain/updates"
import {
  viewLayoutKinds,
  viewLayoutLabels,
  type ViewProjection,
  viewProjectionLabels,
  viewProjections
} from "../domain/viewLayout"
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
import { PREFAB_TAB_STAYS_HERE, useEditor, useOpenPrefab, useOpenProjectMap } from "../editor/store"
import { resetDockLayout, usePanelCheck, useViewMenuPanels } from "./dock/dockControl"
import { SavePrefabItem } from "./SavePrefabItem"

/** The action's primary binding, as the menu shows it (nothing when unbound). */
function Shortcut({ action }: { readonly action: KeybindAction }) {
  const binding = useEditor((s) => s.keybinds[action][0])
  return binding === undefined ? null : <MenubarShortcut className="pl-6">{formatBinding(binding)}</MenubarShortcut>
}

/** A menu item that runs the same command as the action's keybind, and shows that keybind. */
function CommandItem({ action, disabled = false, inset, children }: {
  readonly action: CommandAction
  readonly disabled?: boolean
  /**
   * Lines the label up with checkbox and radio items in the same menu. Absent otherwise:
   * any `data-inset` attribute, even "false", draws the checkmark gutter.
   */
  readonly inset?: boolean
  readonly children: ReactNode
}) {
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
      <MenubarTrigger className="h-7 px-2.5">{title}</MenubarTrigger>
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
              <span className="shrink-0 pl-4 text-fg-tertiary">Open in another window</span>
            )}
          </MenubarItem>
        ))}
      </MenubarSubContent>
    </MenubarSub>
  )
}

function PanelItem({ id, title }: { readonly id: string; readonly title: string }) {
  return <MenubarCheckboxItem {...usePanelCheck(id)}>{title}</MenubarCheckboxItem>
}

type ViewSetting = "appearance" | "lighting" | "snapping"
type FlagOf<S extends ViewSetting> = {
  [K in keyof Settings[S]]: Settings[S][K] extends boolean ? K : never
}[keyof Settings[S]]

/** A check on a boolean setting. */
function SettingCheck<S extends ViewSetting>({ section, flag, children }: {
  readonly section: S
  readonly flag: FlagOf<S>
  readonly children: ReactNode
}) {
  const checked = useEditor((s) => s.settings[section][flag] === true)
  return (
    <MenubarCheckboxItem
      closeOnClick
      checked={checked}
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `FlagOf` says it's a boolean of `section`
      onCheckedChange={(on) => void updateSettings(section, { [flag]: on } as Partial<Settings[S]>)}
    >
      {children}
    </MenubarCheckboxItem>
  )
}

/** A submenu picking one of `options`, each drawn by `children`. */
function RadioMenu<V extends string | number>({ title, className, value, options, onPick, children }: {
  readonly title: string
  readonly className?: string
  readonly value: V
  readonly options: ReadonlyArray<V>
  readonly onPick: (value: V) => void
  readonly children: (option: V) => ReactNode
}) {
  return (
    <MenubarSub>
      <MenubarSubTrigger inset>{title}</MenubarSubTrigger>
      <MenubarSubContent {...(className !== undefined && { className })}>
        <MenubarRadioGroup value={value} onValueChange={(next: V) => onPick(next)}>
          {options.map((option) => (
            <MenubarRadioItem closeOnClick key={option} value={option}>{children(option)}</MenubarRadioItem>
          ))}
        </MenubarRadioGroup>
      </MenubarSubContent>
    </MenubarSub>
  )
}

/** The keybind that puts the active pane on each view; Perspective has only the toggle. */
const PROJECTION_ACTIONS: Readonly<Record<ViewProjection, KeybindAction>> = {
  perspective: "toggleOrthographic",
  top: "viewTop",
  bottom: "viewBottom",
  front: "viewFront",
  back: "viewBack",
  left: "viewLeft",
  right: "viewRight"
}

/** How the view divides into panes, and what the active pane looks along (docs/DESKTOP.md § View panes). */
function PaneMenus() {
  const kind = useEditor((s) => s.viewLayout.kind)
  const projection = useEditor((s) => s.viewLayout.projections[s.activePane] ?? "perspective")
  const setViewLayoutKind = useEditor((s) => s.setViewLayoutKind)
  const lookAlong = (next: ViewProjection) => {
    const { activePane, setPaneProjection } = useEditor.getState()
    setPaneProjection(activePane, next)
  }
  return (
    <>
      <RadioMenu title="Panes" value={kind} options={viewLayoutKinds} onPick={setViewLayoutKind}>
        {(layout) => viewLayoutLabels[layout]}
      </RadioMenu>
      <RadioMenu title="Active pane" className="w-max" value={projection} options={viewProjections} onPick={lookAlong}>
        {(view) => (
          <>
            {viewProjectionLabels[view]}
            <Shortcut action={PROJECTION_ACTIONS[view]} />
          </>
        )}
      </RadioMenu>
    </>
  )
}

const THEMES = { dark: "Dark", light: "Light", system: "System" } as const
const THEME_KEYS = ["dark", "light", "system"] as const

/** File, Edit, View and Project (docs/DESKTOP.md § Menus). Every item calls the entry point its keybind or button uses. */
export function MenuBar() {
  const canUndo = useEditor((s) => s.past.length > 0 && s.preview === null)
  const canCheck = useEditor((s) => s.update !== null && canCheckForUpdates(s.update))
  const canRedo = useEditor((s) => s.future.length > 0 && s.preview === null)
  const selectedIds = useEditor((s) => s.selectedIds)
  const tree = useEditor((s) => s.doc.structure.tree)
  const hasSelection = selectedIds.length > 0
  const canGroup = useMemo(() => canGroupSelection(tree, selectedIds), [tree, selectedIds])
  const canUngroup = useMemo(() => selectedGroupIds(tree, selectedIds).length > 0, [tree, selectedIds])
  const canPaste = useEditor((s) => s.clipboard !== null)
  const openDialog = useEditor((s) => s.openDialog)
  const viewMenuPanels = useViewMenuPanels()
  const { snapping, appearance, general } = useEditor((s) => s.settings)
  const { projects, exportToGame: canExport, launchGame: canLaunchGame, play: canPlay } = useEditor((s) =>
    s.capabilities
  )
  const exportOnSave = useEditor((s) => s.exportOnSave)
  const inPrefab = useOpenPrefab() !== null
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
            <CommandItem action="newMap">New map</CommandItem>
            <MenubarItem onClick={() => openDialog({ id: "newProject" })}>New project…</MenubarItem>
            <MenubarItem onClick={() => void chooseProject()}>Open project…</MenubarItem>
            <RecentProjectsMenu />
            <MenubarSeparator />
            <CommandItem action="saveMap">Save</CommandItem>
            <CommandItem action="closeTab">Close tab</CommandItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => openDialog({ id: "settings" })}>Settings…</MenubarItem>
            <MenubarItem onClick={() => openDialog({ id: "gameLink" })}>Game link…</MenubarItem>
            <MenubarItem disabled={!canCheck} onClick={() => void checkForUpdates()}>Check for updates</MenubarItem>
            <MenubarItem onClick={() => void quitApp()}>Quit</MenubarItem>
          </Menu>
        )
        : (
          <Menu title="File">
            <CommandItem action="newMap">New map</CommandItem>
            <CommandItem action="openMap">Open…</CommandItem>
            <MenubarSeparator />
            <CommandItem action="saveMap">Save</CommandItem>
            <CommandItem action="saveMapAs">Export…</CommandItem>
            <CommandItem action="closeTab">Close tab</CommandItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => openDialog({ id: "settings" })}>Settings…</MenubarItem>
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
        <MenubarSeparator />
        <CommandItem action="groupSelection" disabled={!canGroup}>Group</CommandItem>
        <CommandItem action="ungroupSelection" disabled={!canUngroup}>Ungroup</CommandItem>
        <MenubarSeparator />
        <SavePrefabItem item={MenubarItem} />
      </Menu>
      <Menu title="View">
        <CommandItem action="focusSelection" disabled={!hasSelection} inset>Focus selection</CommandItem>
        <CommandItem action="frameAll" inset>Frame all</CommandItem>
        <PaneMenus />
        <MenubarSeparator />
        {viewMenuPanels.map(({ id, title }) => <PanelItem key={id} id={id} title={title} />)}
        <MenubarItem inset onClick={resetDockLayout}>Reset layout</MenubarItem>
        <MenubarSeparator />
        <SettingCheck section="appearance" flag="gridVisible">Show grid</SettingCheck>
        <SettingCheck section="snapping" flag="enabled">Snap to grid</SettingCheck>
        <RadioMenu
          title="Grid size"
          value={snapping.gridSize}
          options={GRID_SIZES}
          onPick={(gridSize) => void updateSettings("snapping", { enabled: true, gridSize })}
        >
          {(size) => <span className="tabular-nums">{formatGridSize(size, general.units)}</span>}
        </RadioMenu>
        <MenubarSeparator />
        <SettingCheck section="lighting" flag="mapLighting">Map lighting</SettingCheck>
        <SettingCheck section="lighting" flag="skyVisible">Show sky</SettingCheck>
        <SettingCheck section="appearance" flag="waterVisible">Show water</SettingCheck>
        <RadioMenu
          title="Theme"
          value={appearance.theme}
          options={THEME_KEYS}
          onPick={(theme) => void updateSettings("appearance", { theme })}
        >
          {(theme) => THEMES[theme]}
        </RadioMenu>
      </Menu>
      {projects
        ? (
          <Menu title="Project">
            <CommandItem action="newMap" inset>New map</CommandItem>
            <CommandItem action="openMap" inset disabled={untitled}>Import map…</CommandItem>
            {canExport && (
              <>
                <MenubarSeparator />
                <span title={inPrefab ? PREFAB_TAB_STAYS_HERE : undefined}>
                  <MenubarItem inset disabled={inPrefab} onClick={() => void exportToGame()}>
                    Export to game
                  </MenubarItem>
                </span>
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
                {canPlay && (
                  <span title={inPrefab ? PREFAB_TAB_STAYS_HERE : undefined}>
                    <CommandItem action="playMap" inset disabled={inPrefab}>Play</CommandItem>
                  </span>
                )}
                {canLaunchGame && <MenubarItem inset onClick={() => void launchGame()}>Launch game</MenubarItem>}
              </>
            )}
            <MenubarSeparator />
            <MenubarItem inset onClick={() => openDialog({ id: "projectSettings" })}>Project settings…</MenubarItem>
          </Menu>
        )
        : (
          <Menu title="Project">
            <MenubarItem disabled={inPrefab} onClick={() => openDialog({ id: "mapSettings" })}>
              Project settings…
            </MenubarItem>
          </Menu>
        )}
    </Menubar>
  )
}
