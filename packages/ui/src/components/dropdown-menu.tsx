import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { IconCheck, IconChevronRight } from "@tabler/icons-react"
import { Switch } from "@workspace/ui/components/switch"
import { usePortalContainer } from "@workspace/ui/lib/portal-container"
import { cn } from "@workspace/ui/lib/utils"
import * as React from "react"

/** What a menu's popup is, in the dropdowns, the menu bar and the context menus. */
export const MENU_POPUP =
  "z-50 max-h-(--available-height) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-sheet p-1 text-popover-foreground shadow-md ring-1 ring-edge duration-150 outline-none data-[side=bottom]:slide-in-from-top-1 data-[side=inline-end]:slide-in-from-left-1 data-[side=inline-start]:slide-in-from-right-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 glass"

/** A row in a menu, of whatever kind; `MENU_ROW_DISABLED` for what can be disabled. */
export const MENU_ROW =
  "flex min-h-7 cursor-default items-center gap-2 rounded-control text-body select-none transition-colors focus-ring focus:bg-hover data-highlighted:bg-hover data-highlighted:active:bg-pressed focus:text-accent-foreground focus:**:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0"

export const MENU_ROW_DISABLED =
  "data-disabled:pointer-events-none data-disabled:text-fg-disabled! data-disabled:**:text-fg-disabled!"

/** A menu item: a dropdown's or a context menu's. */
export const MENU_ITEM =
  `relative px-2 py-1 data-inset:pl-7.5 [&_svg:not([class*='size-'])]:size-3.5 ${MENU_ROW} ${MENU_ROW_DISABLED}`

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}:
  & MenuPrimitive.Popup.Props
  & Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >)
{
  return (
    <MenuPrimitive.Portal container={usePortalContainer()}>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            MENU_POPUP,
            "w-(--anchor-width) data-closed:overflow-hidden",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1.5 text-caption text-fg-tertiary data-inset:pl-7.5",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      className={cn(MENU_ITEM, className)}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        MENU_ROW,
        "px-2 py-1 data-inset:pl-7.5 data-popup-open:bg-hover data-open:bg-hover [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <IconChevronRight className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn("w-auto", className)}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

/** A setting in a menu: its row toggles it and the menu stays open, so the switch is only what it looks like. */
function DropdownMenuSwitchItem({
  className,
  children,
  checked,
  ...props
}: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-switch-item"
      closeOnClick={false}
      className={cn(
        "flex min-h-7 cursor-default items-center justify-between gap-4 rounded-control px-2 py-1 text-body outline-hidden select-none focus:bg-foreground/8 data-highlighted:bg-foreground/8 focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:text-fg-disabled!",
        className
      )}
      checked={checked}
      {...props}
    >
      {children}
      <Switch aria-hidden checked={checked} tabIndex={-1} className="pointer-events-none" />
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        MENU_ROW,
        MENU_ROW_DISABLED,
        "relative py-1.5 pr-8 pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <IconCheck />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger
}
