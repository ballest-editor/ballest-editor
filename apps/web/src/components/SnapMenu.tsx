import { IconChevronDown, IconMagnet } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"
import { Toggle } from "@workspace/ui/components/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { useState } from "react"
import {
  formatGridSize,
  formatRotationStep,
  formatScaleStep,
  GRID_SIZES,
  ROTATION_STEPS,
  SCALE_STEPS
} from "../domain/snap"
import { SNAP_PRESETS } from "../domain/snapConfig"
import { pickGridSize, setSnapTargets, toggleSnapping, updateSnap, updateSnapTarget } from "../editor/actions"
import { noTabOpen, snapConfigOf, useEditor } from "../editor/store"
import { KeyChip } from "./KeyChip"
import { PullSlider, Row, Segmented, StepRow, SwitchRow } from "./SnapParameters"
import { PRESET_NAMES, presetOf } from "./SnapPopover"
import { noFocus, pointerOpensOnly } from "./viewControlStyle"

/**
 * The snap menu's rows (docs/SNAPPING.md § The Snap popover): snapping as a whole, then each kind of snapping under it,
 * which stays dimmed but working while it is off, the priority and the connectors' pull, and the ways to the rest.
 */
export function SnapMenuContent({ onClose }: { readonly onClose: () => void }) {
  const config = useEditor(snapConfigOf)
  const units = useEditor((s) => s.settings.general.units)
  const openDialog = useEditor((s) => s.openDialog)
  const setSnapPopoverOpen = useEditor((s) => s.setSnapPopoverOpen)
  const { alignment, connectors, grid, mesh, tracking } = config.targets
  const dimmed = !config.enabled
  return (
    <div className="flex flex-col gap-2 px-3 py-2" data-snap-menu>
      <SwitchRow strong label="Snapping" checked={config.enabled} onChange={(enabled) => updateSnap({ enabled })} />
      <div className="flex flex-col">
        <StepRow
          label="Grid"
          dimmed={dimmed}
          step={{
            label: "Grid step",
            value: config.gridSize,
            options: GRID_SIZES,
            format: (size) => formatGridSize(size, units),
            unit: "cm",
            onChange: pickGridSize
          }}
          enabled={grid.enabled}
          onEnabled={(enabled) => updateSnapTarget("grid", { enabled })}
        />
        <StepRow
          label="Rotation"
          dimmed={dimmed}
          step={{
            label: "Rotation step",
            value: config.rotationStep,
            options: ROTATION_STEPS,
            format: formatRotationStep,
            unit: "°",
            onChange: (rotationStep) => updateSnap({ rotationEnabled: true, rotationStep })
          }}
          enabled={config.rotationEnabled}
          onEnabled={(rotationEnabled) => updateSnap({ rotationEnabled })}
        />
        <StepRow
          label="Scale"
          dimmed={dimmed}
          step={{
            label: "Scale step",
            value: config.scaleStep,
            options: SCALE_STEPS,
            format: formatScaleStep,
            unit: "%",
            onChange: (scaleStep) => updateSnap({ scaleEnabled: true, scaleStep })
          }}
          enabled={config.scaleEnabled}
          onEnabled={(scaleEnabled) => updateSnap({ scaleEnabled })}
        />
        <SwitchRow
          label="Connectors"
          dimmed={dimmed}
          checked={connectors.enabled}
          onChange={(enabled) => updateSnapTarget("connectors", { enabled })}
        />
        <SwitchRow
          label="Mesh"
          dimmed={dimmed}
          checked={mesh.enabled}
          onChange={(enabled) => updateSnapTarget("mesh", { enabled })}
        />
        <SwitchRow
          label="Alignment and tracking"
          dimmed={dimmed}
          checked={alignment.enabled && tracking.enabled}
          onChange={(on) => setSnapTargets(["alignment", "tracking"], on)}
        />
      </div>
      <div className="flex flex-col">
        <Row label="Priority" dimmed={dimmed}>
          <Segmented
            label="Priority"
            value={presetOf(config)}
            items={PRESET_NAMES}
            onChange={(preset) => updateSnap({ order: SNAP_PRESETS[preset] })}
          />
        </Row>
        <PullSlider
          weight={connectors.weight}
          dimmed={dimmed}
          onChange={(weight) => updateSnapTarget("connectors", { weight })}
        />
      </div>
      <div className="flex justify-end gap-1">
        <Button
          variant="ghost"
          onClick={() => {
            onClose()
            openDialog({ id: "settings", category: "editor" })
          }}
        >
          Defaults…
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            onClose()
            setSnapPopoverOpen(true)
          }}
        >
          Snap settings…
        </Button>
      </div>
    </div>
  )
}

/**
 * Snapping as a whole, in the top bar after the menus: a magnet that turns it on and off (`snapToggle`), and beside it
 * the snap menu. It sits with the menus because it is a way of editing, as they are, and the bar's right end is for
 * what goes to the game, which a browser doesn't show; there the magnet would be alone at the far edge. Pointer-only,
 * as the viewport's controls are, so Space after a click still flies.
 */
export function SnapControl() {
  const enabled = useEditor((s) => snapConfigOf(s).enabled)
  const off = useEditor(noTabOpen)
  const keybinds = useEditor((s) => s.keybinds.snapToggle)
  const [open, setOpen] = useState(false)
  const label = `Snapping: ${enabled ? "on" : "off"}`
  return (
    <div className="flex items-center">
      <Tooltip onOpenChange={pointerOpensOnly}>
        <TooltipTrigger
          render={
            <Toggle
              pressed={enabled}
              onPressedChange={toggleSnapping}
              disabled={off}
              aria-label="Snapping"
              className="rounded-r-none"
              {...noFocus}
            />
          }
        >
          <IconMagnet />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {label}
          {keybinds.map((binding) => <KeyChip key={binding} binding={binding} />)}
        </TooltipContent>
      </Tooltip>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip onOpenChange={pointerOpensOnly}>
          <TooltipTrigger
            render={
              <PopoverTrigger
                disabled={off}
                render={
                  <Button
                    variant="ghost"
                    aria-label="Snap menu"
                    className="w-5 rounded-l-none px-0 text-fg-secondary aria-expanded:bg-hover"
                    {...noFocus}
                  />
                }
              />
            }
          >
            <IconChevronDown className="size-3" />
          </TooltipTrigger>
          <TooltipContent side="bottom">Snap menu</TooltipContent>
        </Tooltip>
        <PopoverContent align="start" initialFocus={false} finalFocus={false} className="w-80 gap-0 p-0">
          <SnapMenuContent onClose={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
