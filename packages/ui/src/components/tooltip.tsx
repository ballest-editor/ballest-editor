"use client"

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { usePortalContainer } from "@workspace/ui/lib/portal-container"
import { cn } from "@workspace/ui/lib/utils"

/** How long the pointer rests on something before its tooltip shows, unless the trigger says otherwise. */
const TOOLTIP_DELAY = 300

function TooltipProvider({
  delay = TOOLTIP_DELAY,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ delay = TOOLTIP_DELAY, ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" delay={delay} {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  align = "center",
  alignOffset = 0,
  collisionBoundary,
  children,
  ...props
}:
  & TooltipPrimitive.Popup.Props
  & Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "collisionBoundary" | "side" | "sideOffset"
  >)
{
  return (
    <TooltipPrimitive.Portal container={usePortalContainer()}>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        collisionBoundary={collisionBoundary}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 glass rounded-sheet px-2.5 py-1 text-body text-popover-foreground shadow-md ring-1 ring-foreground/8 duration-150 has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-1 data-[side=inline-end]:slide-in-from-left-1 data-[side=inline-start]:slide-in-from-right-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-control data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
