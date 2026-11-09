import { type RootState, useFrame, useThree } from "@react-three/fiber"
import { useEffect, useRef } from "react"
import { editorVerticalFov, MOTION_SCALE } from "../domain/Settings"
import { firstPaneTurns, paneRects, type PaneSlot, panesToDraw, type PaneTurns } from "../domain/viewLayout"
import { useAreaDrag } from "./areaDrag"
import { meshBatches } from "./meshBatches"
import { mapBox, type PaneCamera, paneCamerasOf, VIEW_TWEEN_MS } from "./paneCameras"
import { sceneRegistry } from "./sceneRegistry"
import { useEditor } from "./store"

type BeforePaneDraw = (pane: PaneCamera, slot: PaneSlot) => void

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
let shown = ""
let turns: PaneTurns = firstPaneTurns
/** The editor's state changed since the panes last drew: what they show may have, in every pane. */
let stateChanged = false

/**
 * Draws the panes into the one canvas, each in its own viewport and scissor. The drawing buffer is preserved, so a pane
 * not drawn this frame keeps what it last showed (`panesToDraw` says which those are).
 */
const drawPanes = ({ gl, scene, size }: Pick<RootState, "gl" | "scene" | "size">, everyPane: boolean): void => {
  const { tabId, viewLayout, activePane, settings, keybindDefaults } = useEditor.getState()
  const rects = paneRects(viewLayout, size.width, size.height).filter((r) => r.width > 0 && r.height > 0)
  const panes = paneCamerasOf(tabId)
  const fov = editorVerticalFov(settings.camera, keybindDefaults.cameraPresets)
  const now = performance.now()
  for (const rect of rects) {
    const pane = panes[rect.slot]
    if (pane === undefined) continue
    pane.resize(rect.width, rect.height, fov)
    pane.followProjection(viewLayout.projections[rect.slot])
    if (pane.needsFraming) {
      pane.needsFraming = false
      pane.frameMap(mapBox())
    }
    pane.stepTween(now, VIEW_TWEEN_MS * MOTION_SCALE[settings.appearance.motion])
  }
  sceneRegistry.camera = panes[activePane]?.camera ?? null

  // Once a frame, not once a pane: `gl.render` would otherwise walk the whole scene each time.
  scene.updateMatrixWorld()
  const firstCamera = panes[rects[0]?.slot ?? activePane]?.drawCamera
  const moved = firstCamera !== undefined && meshBatches.sync(gl, scene, firstCamera)

  const key = JSON.stringify([
    tabId,
    rects,
    rects.map((r) => panes[r.slot]?.projection),
    settings.appearance.gridVisible,
    settings.lighting.skyVisible
  ])
  // A change to the scene (an edit, a drag ahead of the store, a selection) shows in every pane at once; the camera
  // of one pane moving shows in that pane alone, and the others take turns as they idle.
  const plan = panesToDraw(
    rects.map((r) => r.slot),
    activePane,
    now,
    turns,
    everyPane || key !== shown || moved || stateChanged
  )
  shown = key
  turns = plan.turns
  stateChanged = false
  gl.setScissorTest(true)
  for (const slot of plan.slots) {
    const rect = rects.find((r) => r.slot === slot)
    const pane = panes[slot]
    if (rect === undefined || pane === undefined) continue
    const bottom = size.height - rect.y - rect.height
    gl.setViewport(rect.x, bottom, rect.width, rect.height)
    gl.setScissor(rect.x, bottom, rect.width, rect.height)
    for (const callback of beforeDraw) callback(pane, rect.slot)
    gl.render(scene, pane.drawCamera)
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
    scene.add(meshBatches.root)
    const changed = () => {
      stateChanged = true
    }
    // a box or lasso's drag keeps a store of its own, and its outlines show in every pane too
    const unsubscribe = [useEditor.subscribe(changed), useAreaDrag.subscribe(changed)]
    return () => {
      for (const stop of unsubscribe) stop()
      scene.remove(meshBatches.root)
      meshBatches.dispose()
    }
  }, [scene])
  useFrame((state) => drawPanes(state, false), 1)
  return null
}
