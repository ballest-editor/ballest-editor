import { RELEASES_URL } from "@ballest/contracts"
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { type ReactElement, type ReactNode, useMemo } from "react"
import { canGroupSelection, selectedGroupIds } from "../domain/groupSelection"
import { type KeybindAction, PROJECTION_ACTIONS } from "../domain/Keybinds"
import { formatGridSize, GRID_SIZES } from "../domain/snap"
import { updateCheckBlockedBy } from "../domain/updates"
import {
  viewLayoutKinds,
  viewLayoutLabelsOf,
  type ViewProjection,
  viewProjectionLabels,
  viewProjections
} from "../domain/viewLayout"
import {
  checkForUpdates,
  chooseProject,
  exportToGame,
  launchGame,
  openExternalLink,
  openRecentInNewWindow,
  quitApp,
  reimportMap,
  switchProject,
  updateSettings
} from "../editor/actions"
import { actionCommands, type CommandAction } from "../editor/commands"
import { PREFAB_TAB_STAYS_HERE, useEditor, useOpenPrefab, useOpenProjectMap, useUpdateState } from "../editor/store"
import { resetDockLayout, usePanelCheck, useViewMenuPanels } from "./dock/dockControl"
import { KeyChip } from "./KeyChip"
import { SavePrefabItem } from "./SavePrefabItem"

const NOTHING_SELECTED = "Select something first."
const SAVE_PROJECT_FIRST = "Save first: Untitled Project has no folder to import into."
const EXPORT_FIRST = "Export this map first: the game has no copy of it yet."

/** The action's primary binding, as the menu shows it (nothing when unbound). */
function Shortcut({ action }: { readonly action: KeybindAction }) {
  const binding = useEditor((s) => s.keybinds[action][0])
  return binding === undefined ? null : (
    <MenubarShortcut className="pl-6">
      <KeyChip binding={binding} />
    </MenubarShortcut>
  )
}

/** Says why a row is off. A disabled row gets no pointer events, so the tooltip lives on a wrapper. */
function DisabledReason({ reason, children }: { readonly reason: string | null; readonly children: ReactElement }) {
  if (reason === null) return children
  return (
    <Tooltip>
      <TooltipTrigger render={<div />}>{children}</TooltipTrigger>
      <TooltipContent side="right">{reason}</TooltipContent>
    </Tooltip>
  )
}

interface ItemProps {
  /** Why the row is off; null or absent when it's on. */
  readonly reason?: string | null
  /**
   * Lines the label up with checkbox and radio items in the same menu. Absent otherwise:
   * any `data-inset` attribute, even "false", draws the checkmark gutter.
   */
  readonly inset?: boolean
  readonly children: ReactNode
}

function Item({ reason = null, inset, onClick, children }: ItemProps & { readonly onClick: () => void }) {
  return (
    <DisabledReason reason={reason}>
      <MenubarItem disabled={reason !== null} {...(inset && { inset })} onClick={onClick}>{children}</MenubarItem>
    </DisabledReason>
  )
}

/** A menu item that runs the same command as the action's keybind, and shows that keybind. */
function CommandItem({ action, children, ...item }: ItemProps & { readonly action: CommandAction }) {
  return (
    <Item {...item} onClick={() => actionCommands[action]()}>
      {children}
      <Shortcut action={action} />
    </Item>
  )
}

/** Gives the focus back to the page if it is on a menu or the menu bar. */
const leaveMenus = () => {
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused.closest("[role=menu], [role=menubar]") !== null) focused.blur()
}

/**
 * One top-level menu. Closing it leaves focus on the page, however it closed, as a dialog does: on a title, Space and
 * the arrows would work the menu bar and not the editor. It leaves as the menu starts to close, since Base UI holds it
 * in the popup until the exit animation ends, and the keys pressed until then would be lost. A click on the title
 * focuses it after this, so it leaves again a frame later. Only a move to the next menu (`sibling-open`) stays in the
 * bar.
 */
function Menu({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <MenubarMenu
      onOpenChange={(open, { reason }) => {
        if (open || reason === "sibling-open") return
        leaveMenus()
        requestAnimationFrame(leaveMenus)
      }}
    >
      <MenubarTrigger className="h-7 px-2.5">{title}</MenubarTrigger>
      {/* Sized to the longest row (label and shortcut on one line), not to the menu's title. */}
      <MenubarContent className="w-max min-w-40" finalFocus={false}>
        {children}
      </MenubarContent>
    </MenubarMenu>
  )
}

/**
 * Desktop only: the projects used before, by name (the folder is the tooltip). A pick opens here (`switchProject`),
 * Shift+click in a new window. One open in another window says so, and picking it still gets main's refusal, which says
 * what to do.
 */
function RecentProjectsMenu() {
  const state = useEditor((s) => s.project)
  const recent = state?.recent ?? []
  const openElsewhere = state?.openElsewhere ?? []
  return (
    <MenubarSub>
      <DisabledReason reason={recent.length === 0 ? "No recent projects yet." : null}>
        {/* Unlike an item, a disabled submenu title keeps the pointer: it would light up and take focus. */}
        <MenubarSubTrigger disabled={recent.length === 0} className="data-disabled:pointer-events-none">
          Recent projects
        </MenubarSubTrigger>
      </DisabledReason>
      <MenubarSubContent className="w-max max-w-96">
        <MenubarGroup>
          <MenubarLabel className="text-fg-tertiary">Shift+click opens in a new window</MenubarLabel>
        </MenubarGroup>
        {recent.map((project) => (
          <MenubarItem
            key={project.path}
            title={project.path}
            onClick={(e) => void (e.shiftKey ? openRecentInNewWindow(project) : switchProject(project.path))}
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

/** A submenu picking one of `options`, each drawn by `children`, under a line saying what it picks when it needs one. */
function RadioMenu<V extends string | number>({ title, description, value, options, onPick, children }: {
  readonly title: string
  readonly description?: string
  readonly value: V
  readonly options: ReadonlyArray<V>
  readonly onPick: (value: V) => void
  readonly children: (option: V) => ReactNode
}) {
  return (
    <MenubarSub>
      <MenubarSubTrigger inset>{title}</MenubarSubTrigger>
      <MenubarSubContent className="w-max max-w-72">
        {description !== undefined && (
          <MenubarGroup>
            <MenubarLabel className="text-fg-tertiary">{description}</MenubarLabel>
          </MenubarGroup>
        )}
        <MenubarRadioGroup value={value} onValueChange={(next: V) => onPick(next)}>
          {options.map((option) => (
            <MenubarRadioItem closeOnClick key={option} value={option}>{children(option)}</MenubarRadioItem>
          ))}
        </MenubarRadioGroup>
      </MenubarSubContent>
    </MenubarSub>
  )
}

/** A named part of a menu whose rows are too different to read as one list. */
function MenuSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <MenubarGroup>
      <MenubarLabel inset className="uppercase tracking-wider">{title}</MenubarLabel>
      {children}
    </MenubarGroup>
  )
}

/** How the view divides into panes, and what the active pane looks along (docs/DESKTOP.md § View panes). */
function PaneMenus() {
  const layout = useEditor((s) => s.viewLayout)
  const projection = useEditor((s) => s.viewLayout.projections[s.activePane] ?? "perspective")
  const setViewLayoutKind = useEditor((s) => s.setViewLayoutKind)
  const lookAlong = (next: ViewProjection) => {
    const { activePane, setPaneProjection } = useEditor.getState()
    setPaneProjection(activePane, next)
  }
  return (
    <MenuSection title="Panes">
      <RadioMenu
        title="Layout"
        description="Split the viewport, one camera per pane."
        value={layout.kind}
        options={viewLayoutKinds}
        onPick={setViewLayoutKind}
      >
        {(kind) => viewLayoutLabelsOf(layout)[kind]}
      </RadioMenu>
      <RadioMenu
        title="Active pane"
        description="The view in the pane you last used."
        value={projection}
        options={viewProjections}
        onPick={lookAlong}
      >
        {(view) => (
          <>
            {viewProjectionLabels[view]}
            <Shortcut action={PROJECTION_ACTIONS[view]} />
          </>
        )}
      </RadioMenu>
    </MenuSection>
  )
}

/** Help, in both builds; a browser has no updater, so no update rows. */
function HelpMenu() {
  const update = useUpdateState()
  const openDialog = useEditor((s) => s.openDialog)
  return (
    <Menu title="Help">
      {/* not the keybind's command: that one shows the sheet only while the key is held */}
      <MenubarItem onClick={() => openDialog({ id: "keybinds" })}>
        Keyboard shortcuts
        <Shortcut action="showKeybinds" />
      </MenubarItem>
      <MenubarSeparator />
      {update !== null && (
        <>
          <Item reason={updateCheckBlockedBy(update)} onClick={() => void checkForUpdates()}>Check for updates</Item>
          <MenubarItem onClick={() => void openExternalLink(RELEASES_URL)}>Release notes</MenubarItem>
        </>
      )}
      <MenubarItem onClick={() => openDialog({ id: "about" })}>About Ballest Editor</MenubarItem>
    </Menu>
  )
}

/** File, Edit, View, Project and Help (docs/DESKTOP.md § Menus). Every item calls the entry point its keybind or button uses. */
export function MenuBar() {
  const canUndo = useEditor((s) => s.past.length > 0 && s.preview === null)
  const canRedo = useEditor((s) => s.future.length > 0 && s.preview === null)
  const selectedIds = useEditor((s) => s.selectedIds)
  const tree = useEditor((s) => s.doc.structure.tree)
  const selectionOff = selectedIds.length > 0 ? null : NOTHING_SELECTED
  const canGroup = useMemo(() => canGroupSelection(tree, selectedIds), [tree, selectedIds])
  const canUngroup = useMemo(() => selectedGroupIds(tree, selectedIds).length > 0, [tree, selectedIds])
  const canPaste = useEditor((s) => s.clipboard !== null)
  const openDialog = useEditor((s) => s.openDialog)
  const viewMenuPanels = useViewMenuPanels()
  const { snapping, general } = useEditor((s) => s.settings)
  const { projects, exportToGame: canExport, launchGame: canLaunchGame, play: canPlay } = useEditor((s) =>
    s.capabilities
  )
  const prefabOff = useOpenPrefab() === null ? null : PREFAB_TAB_STAYS_HERE
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
            <MenubarSeparator />
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
        <CommandItem action="undo" reason={canUndo ? null : "Nothing to undo."}>Undo</CommandItem>
        <CommandItem action="redo" reason={canRedo ? null : "Nothing to redo."}>Redo</CommandItem>
        <MenubarSeparator />
        <CommandItem action="cutSelection" reason={selectionOff}>Cut</CommandItem>
        <CommandItem action="copySelection" reason={selectionOff}>Copy</CommandItem>
        <CommandItem action="paste" reason={canPaste ? null : "Copy something first."}>Paste</CommandItem>
        <CommandItem action="duplicateSelection" reason={selectionOff}>Duplicate</CommandItem>
        <CommandItem action="deleteSelection" reason={selectionOff}>Delete</CommandItem>
        <CommandItem action="deselect" reason={selectionOff}>Deselect</CommandItem>
        <MenubarSeparator />
        <CommandItem action="groupSelection" reason={canGroup ? null : "Select what to group first."}>
          Group
        </CommandItem>
        <CommandItem action="ungroupSelection" reason={canUngroup ? null : "Select a group first."}>
          Ungroup
        </CommandItem>
        <MenubarSeparator />
        <SavePrefabItem item={MenubarItem} />
      </Menu>
      <Menu title="View">
        <MenuSection title="Camera">
          <CommandItem action="focusSelection" reason={selectionOff} inset>Focus selection</CommandItem>
          <CommandItem action="frameAll" inset>Frame all</CommandItem>
        </MenuSection>
        <MenubarSeparator />
        <MenuSection title="Panels">
          {viewMenuPanels.map(({ id, title }) => <PanelItem key={id} id={id} title={title} />)}
          <MenubarItem inset onClick={resetDockLayout}>Reset layout</MenubarItem>
        </MenuSection>
        <MenubarSeparator />
        <PaneMenus />
        <MenubarSeparator />
        <MenuSection title="Grid">
          <MenubarCheckboxItem
            closeOnClick
            checked={snapping.enabled}
            onCheckedChange={(enabled) => void updateSettings("snapping", { enabled })}
          >
            Snap to grid
          </MenubarCheckboxItem>
          <RadioMenu
            title="Grid size"
            value={snapping.gridSize}
            options={GRID_SIZES}
            onPick={(gridSize) => void updateSettings("snapping", { enabled: true, gridSize })}
          >
            {(size) => <span className="tabular-nums">{formatGridSize(size, general.units)}</span>}
          </RadioMenu>
        </MenuSection>
      </Menu>
      {projects
        ? (
          <Menu title="Project">
            <CommandItem action="newMap">New map</CommandItem>
            <CommandItem action="openMap" reason={untitled ? SAVE_PROJECT_FIRST : null}>Import map…</CommandItem>
            {canExport && (
              <>
                <Item reason={prefabOff} onClick={() => void exportToGame()}>Export to game</Item>
                <Item
                  reason={prefabOff ?? (reimportable === null ? EXPORT_FIRST : null)}
                  onClick={() => reimportable !== null && void reimportMap(reimportable)}
                >
                  Re-import from game
                </Item>
                {(canPlay || canLaunchGame) && <MenubarSeparator />}
                {canPlay && <CommandItem action="playMap" reason={prefabOff}>Play</CommandItem>}
                {canLaunchGame && <MenubarItem onClick={() => void launchGame()}>Open game (Steam)</MenubarItem>}
              </>
            )}
            <MenubarSeparator />
            <MenubarItem onClick={() => openDialog({ id: "projectSettings" })}>Project settings…</MenubarItem>
          </Menu>
        )
        : (
          <Menu title="Project">
            <Item reason={prefabOff} onClick={() => openDialog({ id: "mapSettings" })}>Project settings…</Item>
          </Menu>
        )}
      <HelpMenu />
    </Menubar>
  )
}
