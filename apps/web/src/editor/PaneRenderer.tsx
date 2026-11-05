import { type RootState, useFrame, useThree } from "@react-three/fiber"
import { useEffect, useRef } from "react"
import { editorVerticalFov } from "../domain/Settings"
import { firstPaneTurns, type PaneRect, paneRects, panesToDraw, type PaneTurns } from "../domain/viewLayout"
import { mapBox, type PaneCamera, paneCamerasOf } from "./paneCameras"
import { sceneRegistry } from "./sceneRegistry"
import { useEditor } from "./store"

type BeforePaneDraw = (pane: PaneCamera, slot: number) => void

const beforeDraw = new Set<BeforePaneDraw>()

/**
 * Runs `callback` before each pane draws, for what has to face the pane's own camera (the sky, the gizmo). The scene is
 * shared, so whatever it sets holds for that pane's draw alone.
 */
export const useBeforePaneDraw = (callback: BeforePaneDraw): void => {
  const latest = useRef(callback)
  useEffect(() => {
    latest.current = callback
  })
  useEffect(() => {
    const call: BeforePaneDraw = (pane, slot) => latest.current(pane, slot)
    beforeDraw.add(call)
    return () => void beforeDraw.delete(call)
  }, [])
}

/** What the canvas's pixels show, as a key: another one means every pane has to draw again. */
const shownKey = (tabId: string, rects: ReadonlyArray<PaneRect>, panes: ReadonlyArray<PaneCamera>): string =>
  JSON.stringify([tabId, rects, rects.map((r) => panes[r.slot]?.projection)])

let shown = ""
let turns: PaneTurns = firstPaneTurns

/** Brings the visible panes' cameras up to the store, the pane sizes and the FOV setting, framing any new to the screen. */
const syncPanes = (rects: ReadonlyArray<PaneRect>, panes: ReadonlyArray<PaneCamera>): void => {
  const { viewLayout, settings, keybindDefaults } = useEditor.getState()
  const fov = editorVerticalFov(settings.camera, keybindDefaults.cameraPresets)
  for (const rect of rects) {
    const pane = panes[rect.slot]
    if (pane === undefined) continue
    pane.resize(rect.width, rect.height, fov)
    pane.setProjection(viewLayout.projections[rect.slot] ?? "perspective")
    if (pane.needsFraming) {
      pane.needsFraming = false
      pane.frameMap(mapBox())
    }
  }
}

/**
 * Draws the panes into the one canvas, each in its own viewport and scissor. The drawing buffer is preserved, so a pane
 * not drawn this frame keeps what it last showed (`panesToDraw` says which those are). Nothing draws behind another tab.
 */
const drawPanes = ({ gl, scene, size }: Pick<RootState, "gl" | "scene" | "size">, everyPane: boolean): void => {
  const { tabId, viewLayout, activePane, mapInFront } = useEditor.getState()
  if (!mapInFront) {
    shown = ""
    return
  }
  const rects = paneRects(viewLayout, size.width, size.height).filter((r) => r.width > 0 && r.height > 0)
  const panes = paneCamerasOf(tabId)
  syncPanes(rects, panes)
  sceneRegistry.camera = panes[activePane]?.camera ?? null

  const key = shownKey(tabId, rects, panes)
  const plan = panesToDraw(rects.map((r) => r.slot), activePane, performance.now(), turns, everyPane || key !== shown)
  shown = key
  turns = plan.turns

  // Once a frame, not once a pane: `gl.render` would otherwise walk the whole scene each time.
  scene.updateMatrixWorld()
  gl.setScissorTest(true)
  for (const slot of plan.slots) {
    const rect = rects.find((r) => r.slot === slot)
    const pane = panes[slot]
    if (rect === undefined || pane === undefined) continue
    const bottom = size.height - rect.y - rect.height
    gl.setViewport(rect.x, bottom, rect.width, rect.height)
    gl.setScissor(rect.x, bottom, rect.width, rect.height)
    for (const callback of beforeDraw) callback(pane, slot)
    gl.render(scene, pane.camera)
  }
  gl.setScissorTest(false)
}

/** Draws every pane now: a resized canvas is blank until the next draw. */
export const drawEveryPane = (state: Pick<RootState, "gl" | "scene" | "size">): void => drawPanes(state, true)

/** Takes over R3F's render: a `useFrame` with a positive priority stops the default one. */
export function PaneRenderer() {
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    scene.matrixWorldAutoUpdate = false
    // Never moves, and an object that updates its own matrix makes everything under it update too (see ItemObject).
    scene.matrixAutoUpdate = false
  }, [scene])
  useFrame((state) => drawPanes(state, false), 1)
  return null
}
