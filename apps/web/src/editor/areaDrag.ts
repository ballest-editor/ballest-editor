/**
 * The box or lasso being dragged (docs/DESKTOP.md § Box and lasso select), in a store of its own: it changes on every
 * pointer move, and the editor's store would run every selector in the app each time. What reads it is the viewport:
 * the region, the outlines of what a release would select, and the gizmo and pivot dots, which hide meanwhile.
 */
import { create } from "zustand"
import type { AreaMode, AreaOp, AreaShape } from "../domain/areaSelect"
import type { PaneRect } from "../domain/viewLayout"

export interface AreaDrag {
  /** The pane the drag started in, which it stays with, and where it lies in the viewport. */
  readonly slot: number
  readonly rect: PaneRect
  /** In that pane's pixels, y down. */
  readonly shape: AreaShape
  readonly mode: AreaMode
  readonly op: AreaOp
  /** What a release would select: the outlines show this in place of the selection while the drag lasts. */
  readonly result: ReadonlyArray<string>
  /** How many units the region holds. */
  readonly caught: number
}

export const useAreaDrag = create<{ readonly drag: AreaDrag | null }>(() => ({ drag: null }))

export const setAreaDrag = (drag: AreaDrag | null): void => useAreaDrag.setState({ drag })

/** Whether a box or lasso is being dragged. */
export const areaDragging = (): boolean => useAreaDrag.getState().drag !== null
