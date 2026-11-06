import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar"
import { IconCheck } from "@tabler/icons-react"
import {
  DropdownMenuContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  MENU_ROW,
  MENU_ROW_DISABLED
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import * as React from "react"

/** A menu bar's menus are dropdowns; only these parts differ from a dropdown's. */
export {
  DropdownMenu as MenubarMenu,
  DropdownMenuGroup as MenubarGroup,
  DropdownMenuItem as MenubarItem,
  DropdownMenuLabel as MenubarLabel,
  DropdownMenuRadioGroup as MenubarRadioGroup,
  DropdownMenuSeparator as MenubarSeparator,
  DropdownMenuSub as MenubarSub,
  DropdownMenuSubContent as MenubarSubContent
} from "@workspace/ui/components/dropdown-menu"

const CHOICE_ITEM = cn(MENU_ROW, MENU_ROW_DISABLED, "relative py-1 pr-2 pl-7.5")

const CHOICE_MARK =
  "pointer-events-none absolute left-2 flex size-4 items-center justify-center [&_svg:not([class*='size-'])]:size-4"

function Menubar({ className, ...props }: MenubarPrimitive.Props) {
  return (
    <MenubarPrimitive
      data-slot="menubar"
      className={cn("flex h-9 items-center rounded-surface border p-1", className)}
      {...props}
    />
  )
}

function MenubarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuTrigger>) {
  return (
    <DropdownMenuTrigger
      data-slot="menubar-trigger"
      className={cn(
        "flex items-center rounded-control px-2 py-1 text-body select-none transition-colors focus-ring hover:bg-hover active:bg-pressed aria-expanded:bg-hover",
        className
      )}
      {...props}
    />
  )
}

function MenubarContent({
  align = "start",
  alignOffset = -4,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="menubar-content"
      align={align}
      alignOffset={alignOffset}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function MenubarCheckboxItem({ className, children, ...props }: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="menubar-checkbox-item"
      className={cn(CHOICE_ITEM, className)}
      {...props}
    >
      <span className={CHOICE_MARK}>
        <MenuPrimitive.CheckboxItemIndicator>
          <IconCheck />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function MenubarRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="menubar-radio-item"
      className={cn(CHOICE_ITEM, "[&_svg:not([class*='size-'])]:size-3.5", className)}
      {...props}
    >
      <span className={CHOICE_MARK}>
        <MenuPrimitive.RadioItemIndicator>
          <IconCheck />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function MenubarSubTrigger({ className, ...props }: React.ComponentProps<typeof DropdownMenuSubTrigger>) {
  return (
    <DropdownMenuSubTrigger
      data-slot="menubar-sub-trigger"
      className={cn("data-disabled:text-fg-disabled! data-disabled:**:text-fg-disabled!", className)}
      {...props}
    />
  )
}

export { Menubar, MenubarCheckboxItem, MenubarContent, MenubarRadioItem, MenubarSubTrigger, MenubarTrigger }
