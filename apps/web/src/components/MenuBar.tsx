import { IconCheck } from "@tabler/icons-react"
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarEmpty,
  MenubarFilterProvider,
  MenubarGroup,
  MenubarInput,
  MenubarItem,
  MenubarLabel,
  MenubarList,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger
} from "@workspace/ui/components/menubar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { type KeyboardEvent, type ReactElement, type ReactNode, useState } from "react"
import type { KeybindAction } from "../domain/Keybinds"
import { useEditor } from "../editor/store"
import { MenuKey } from "./KeyChip"
import {
  type MenuChoice,
  menuEntries,
  type MenuEntry,
  type MenuItem,
  type MenuNode,
  type MenuSubmenu,
  type MenuTitle,
  searchMenus,
  useMenus
} from "./menuModel"
import { SearchField } from "./SettingsShell"

/** The action's primary binding, as the menu shows it (nothing when unbound). */
function Shortcut({ action }: { readonly action: KeybindAction }) {
  const binding = useEditor((s) => s.keybinds[action][0])
  return binding === undefined ? null : <MenuKey binding={binding} />
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

/** What lines a row's label up with the checkbox and radio items in its menu; absent otherwise. */
interface Indent {
  /** Any `data-inset` attribute, even "false", draws the checkmark gutter. */
  readonly inset?: boolean
}

function Item({ item, inset }: Indent & { readonly item: MenuItem }) {
  return (
    <DisabledReason reason={item.reason}>
      <MenubarItem
        disabled={item.reason !== null}
        {...(inset && { inset })}
        {...(item.title !== undefined && { title: item.title })}
        onClick={item.run}
      >
        <span className="truncate">{item.label}</span>
        {item.note !== undefined && <span className="shrink-0 pl-4 text-fg-tertiary">{item.note}</span>}
        {item.shortcut !== undefined && <Shortcut action={item.shortcut} />}
      </MenubarItem>
    </DisabledReason>
  )
}

function SubmenuDescription({ text }: { readonly text: string }) {
  return (
    <MenubarGroup>
      <MenubarLabel className="text-fg-tertiary">{text}</MenubarLabel>
    </MenubarGroup>
  )
}

function Submenu({ submenu }: { readonly submenu: MenuSubmenu }) {
  return (
    <MenubarSub>
      <DisabledReason reason={submenu.reason}>
        {/* Unlike an item, a disabled submenu title keeps the pointer: it would light up and take focus. */}
        <MenubarSubTrigger disabled={submenu.reason !== null} className="data-disabled:pointer-events-none">
          {submenu.title}
        </MenubarSubTrigger>
      </DisabledReason>
      <MenubarSubContent className="w-max max-w-96">
        <SubmenuDescription text={submenu.description} />
        <Rows nodes={submenu.children} />
      </MenubarSubContent>
    </MenubarSub>
  )
}

function Choice({ choice }: { readonly choice: MenuChoice }) {
  const { title, description, options } = choice
  return (
    <MenubarSub>
      <MenubarSubTrigger inset>{title}</MenubarSubTrigger>
      <MenubarSubContent className="w-max max-w-72">
        {description !== undefined && <SubmenuDescription text={description} />}
        <MenubarRadioGroup
          value={options.findIndex((option) => option.checked)}
          onValueChange={(index: number) => options[index]?.run()}
        >
          {options.map((option, index) => (
            <MenubarRadioItem closeOnClick key={option.label} value={index}>
              {option.label}
              {option.shortcut !== undefined && <Shortcut action={option.shortcut} />}
            </MenubarRadioItem>
          ))}
        </MenubarRadioGroup>
      </MenubarSubContent>
    </MenubarSub>
  )
}

function Row({ node, inset }: Indent & { readonly node: MenuNode }) {
  switch (node.kind) {
    case "separator":
      return <MenubarSeparator />
    case "item":
      return <Item item={node} {...(inset && { inset })} />
    case "check":
      return (
        <MenubarCheckboxItem closeOnClick checked={node.checked} onCheckedChange={() => node.run()}>
          {node.label}
        </MenubarCheckboxItem>
      )
    case "section":
      return (
        <MenubarGroup>
          <MenubarLabel inset className="uppercase tracking-wider">{node.title}</MenubarLabel>
          <Rows nodes={node.children} inset />
        </MenubarGroup>
      )
    case "submenu":
      return <Submenu submenu={node} />
    case "choice":
      return <Choice choice={node} />
  }
}

function Rows({ nodes, inset }: Indent & { readonly nodes: ReadonlyArray<MenuNode> }) {
  return nodes.map((node, index) => (
    // oxlint-disable-next-line react/no-array-index-key -- separators and same-named recent projects have nothing else, and rows don't reorder
    <Row key={index} node={node} {...(inset && { inset })} />
  ))
}

/** One menu's rows. Mounted only while that menu is open, so a closed menu bar follows nothing in the store. */
function MenuRows({ title }: { readonly title: MenuTitle }) {
  return <Rows nodes={useMenus()[title]} />
}

/** Where focus can be in the menus. Help's search field isn't in a `menu`: its list is, and the popup is a `dialog`. */
const MENU_FOCUS = "[role=menu], [role=menubar], [data-slot=menubar-content]"

/** Gives the focus back to the page if it is on a menu or the menu bar. */
const leaveMenus = () => {
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused.closest(MENU_FOCUS) !== null) focused.blur()
}

/**
 * One top-level menu. Closing it leaves focus on the page, however it closed, as a dialog does: on a title, Space and
 * the arrows would work the menu bar and not the editor. It leaves as the menu starts to close, since Base UI holds it
 * in the popup until the exit animation ends, and the keys pressed until then would be lost. A click on the title
 * focuses it after this, so it leaves again a frame later. Only a move to the next menu (`sibling-open`) stays in the
 * bar.
 */
function Menu({ title, width = "w-max min-w-40", onOpen, children }: {
  readonly title: string
  /** Sized to the longest row (label and shortcut on one line) unless given, not to the menu's title. */
  readonly width?: string
  readonly onOpen?: () => void
  readonly children: ReactNode
}) {
  return (
    <MenubarMenu
      onOpenChange={(open, { reason }) => {
        if (open) onOpen?.()
        if (open || reason === "sibling-open") return
        leaveMenus()
        requestAnimationFrame(leaveMenus)
      }}
    >
      <MenubarTrigger className="h-7 px-2.5">{title}</MenubarTrigger>
      <MenubarContent className={width} finalFocus={false}>
        {children}
      </MenubarContent>
    </MenubarMenu>
  )
}

/**
 * A row of Help's search: a real menu item, so the filter's arrows, Enter and pointer all work it. Its reason stays
 * readable however dim the row is, as it's the only way to see why.
 */
function SearchResult({ entry }: { readonly entry: MenuEntry }) {
  const { label, path, reason, shortcut, checked } = entry
  return (
    <MenubarItem
      disabled={reason !== null}
      onClick={entry.run}
      className="items-start py-0.5 data-disabled:[&_[data-reason]]:text-fg-tertiary!"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate">{label}</span>
          {checked === true && <IconCheck aria-label="On" />}
        </span>
        <span className="block truncate text-caption text-fg-tertiary">{path.join(" › ")}</span>
        {reason !== null && <span data-reason className="block text-caption">{reason}</span>}
      </span>
      {shortcut !== undefined && <Shortcut action={shortcut} />}
    </MenubarItem>
  )
}

/** Every menu's rows that `query` finds. Mounted only while Help is open, as `MenuRows` is. */
function SearchResults({ query }: { readonly query: string }) {
  return searchMenus(menuEntries(useMenus()), query).map((entry, index) => (
    // oxlint-disable-next-line react/no-array-index-key -- a row's place in the results is all that tells two same-named recent projects apart
    <SearchResult key={index} entry={entry} />
  ))
}

/**
 * Help, with a field over its rows that searches every menu, as macOS's Help does. The filter runs the keys and we
 * draw the rows (`filter={null}`). It would empty the query as the popup starts to close, which would swap the results
 * for Help's rows while they fade, so the query stays until the next open.
 */
function HelpMenu() {
  const [query, setQuery] = useState("")
  // Escape would close the menu: the first one only empties the field
  const clearOnEscape = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Escape" || query === "") return
    e.stopPropagation()
    setQuery("")
  }
  return (
    <MenubarFilterProvider
      filter={null}
      autoHighlight
      value={query}
      onValueChange={(next, { reason }) => {
        if (reason !== "popup-close") setQuery(next)
      }}
    >
      <Menu title="Help" width="w-80" onOpen={() => setQuery("")}>
        <MenubarInput
          aria-label="Search the menus"
          placeholder="Search the menus"
          render={<SearchField className="mb-1" inputClassName="focus-ring-inset" />}
          onKeyDown={clearOnEscape}
        />
        {/* Out to the popup's edges, where a separator's negative margin reaches, or it would scroll sideways. */}
        <MenubarList className="-mx-1 max-h-96 overflow-x-hidden overflow-y-auto px-1 dark:scheme-dark">
          {query.trim() === "" ? <MenuRows title="Help" /> : <SearchResults query={query} />}
          <MenubarEmpty>Nothing in the menus matches.</MenubarEmpty>
        </MenubarList>
      </Menu>
    </MenubarFilterProvider>
  )
}

const PLAIN_MENUS: ReadonlyArray<MenuTitle> = ["File", "Edit", "View", "Project"]

/** File, Edit, View, Project and Help (docs/DESKTOP.md § Menus), drawn from `menuModel`. */
export function MenuBar() {
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
      {PLAIN_MENUS.map((title) => (
        <Menu key={title} title={title}>
          <MenuRows title={title} />
        </Menu>
      ))}
      <HelpMenu />
    </Menubar>
  )
}
