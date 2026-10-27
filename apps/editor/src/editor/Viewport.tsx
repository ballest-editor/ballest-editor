import { Grid } from "@react-three/drei"
import { Canvas, useFrame, useStore, useThree } from "@react-three/fiber"
import { Badge } from "@workspace/ui/components/badge"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import { indexCatalog } from "../domain/Catalog"
import { mouseChordOf } from "../domain/Keybinds"
import { ToolBar } from "../components/ToolBar"
import { FlyCamera } from "./FlyCamera"
import { GizmoController } from "./gizmo/GizmoController"
import { ItemObject } from "./ItemObject"
import { makeSelectionHelper, updateSelectionHelper } from "./selectionBounds"
import { sceneRegistry } from "./sceneRegistry"
import { useEditor } from "./store"

const CLICK_SLOP_PX = 4

function MapItems() {
  const doc = useEditor((s) => s.doc)
  const catalog = useEditor((s) => s.catalog)
  const index = useMemo(() => (catalog === null ? null : indexCatalog(catalog.catalog)), [catalog])
  const root = useRef<THREE.Group>(null)
  useEffect(() => {
    sceneRegistry.itemsRoot = root.current
  }, [])
  return (
    <group ref={root}>
      {doc.map.items.map((item, i) => <ItemObject key={doc.ids[i]} id={doc.ids[i]!} item={item} index={index} />)}
    </group>
  )
}

/** Plain left-click selection with a manual raycast on click only (cheap for maps with thousands of items). */
function ClickSelect() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      const plainLeft = e.button === 0 && !sceneRegistry.isNavigationChord(mouseChordOf(e))
      down = plainLeft && !sceneRegistry.gizmoActive() ? { x: e.clientX, y: e.clientY } : null
    }
    const onUp = (e: PointerEvent) => {
      if (down === null || e.button !== 0) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > CLICK_SLOP_PX || sceneRegistry.gizmoActive()) return
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(ndc, camera)
      const root = sceneRegistry.itemsRoot
      const hits = root === null ? [] : raycaster.intersectObject(root, true)
      for (const hit of hits) {
        let o: THREE.Object3D | null = hit.object
        while (o !== null && o.userData["itemId"] === undefined) o = o.parent
        if (o !== null) {
          useEditor.getState().select(o.userData["itemId"] as string)
          return
        }
      }
      useEditor.getState().select(null)
    }
    el.addEventListener("pointerdown", onDown)
    el.addEventListener("pointerup", onUp)
    return () => {
      el.removeEventListener("pointerdown", onDown)
      el.removeEventListener("pointerup", onUp)
    }
  }, [camera, gl])
  return null
}

/**
 * Smooth resizing. R3F learns the container size through React state, so the canvas keeps
 * its old pixel size (and is cleared when it finally changes) for a frame or more while the
 * window is dragged. Instead, watch the container ourselves: ResizeObserver callbacks run
 * after layout and before paint, so resizing the renderer, fixing the camera and redrawing
 * here means every painted frame is already the right size. R3F's own later update then
 * sees an unchanged size and does nothing.
 */
function SmoothResize() {
  const store = useStore()
  useEffect(() => {
    const container = store.getState().gl.domElement.parentElement
    if (container === null) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const { width, height } = entry.contentRect
      const state = store.getState()
      if (width <= 0 || height <= 0 || (width === state.size.width && height === state.size.height)) return
      const rect = container.getBoundingClientRect()
      state.setSize(width, height, rect.top, rect.left) // R3F's subscription resizes gl + camera aspect; ours below redraws
    })
    observer.observe(container)
    // Whoever changes the size (us or R3F's own measuring), redraw at once: a resized
    // canvas is blank until the next render.
    const unsubscribe = store.subscribe((state, prev) => {
      if (state.size !== prev.size) state.gl.render(state.scene, state.camera)
    })
    return () => {
      observer.disconnect()
      unsubscribe()
    }
  }, [store])
  return null
}

/**
 * Clear colour follows the theme: dark slate, or a light grey in light mode. The same colour
 * goes on the container behind the canvas, so any strip the canvas hasn't covered yet during
 * a window resize is the scene colour, not black.
 */
function ViewportBackground() {
  const gl = useThree((s) => s.gl)
  const theme = useEditor((s) => s.settings.appearance.theme)
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches)
      const color = dark ? "#1d2128" : "#e9ecf1"
      gl.setClearColor(color)
      const viewport = gl.domElement.closest<HTMLElement>("[data-viewport]")
      if (viewport !== null) viewport.style.backgroundColor = color
    }
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [gl, theme])
  return null
}

/** The ground grid (1 m cells, 10 m sections), styled by the appearance settings. */
function ViewportGrid() {
  const appearance = useEditor((s) => s.settings.appearance)
  if (!appearance.gridVisible) return null
  return (
    <Grid
      infiniteGrid
      cellSize={100}
      sectionSize={1000}
      fadeDistance={60000}
      fadeStrength={2}
      cellColor={appearance.gridCellColor}
      sectionColor={appearance.gridSectionColor}
    />
  )
}

/** Oriented selection box: local bounds parented to the selected item (see selectionBounds.ts). */
function SelectionBox() {
  const selectedId = useEditor((s) => s.selectedId)
  const helper = useMemo(makeSelectionHelper, [])
  useFrame(() => {
    const object = selectedId === null ? undefined : sceneRegistry.objects.get(selectedId)
    if (object === undefined) {
      helper.removeFromParent()
      return
    }
    if (helper.parent !== object) object.add(helper)
    updateSelectionHelper(helper, object) // glbs load async, so keep it fresh
  })
  useEffect(() => () => void helper.removeFromParent(), [helper])
  return null
}

function Overlay() {
  const missing = useEditor((s) => s.missingGlbs)
  const speed = useEditor((s) => s.cameraSpeed)
  return (
    <div className="pointer-events-none absolute inset-2 flex flex-col items-start gap-1.5">
      {missing.size > 0 && (
        <Badge variant="destructive" className="pointer-events-auto" title={[...missing].join("\n")}>
          {missing.size} mesh file{missing.size === 1 ? "" : "s"} failed to load
        </Badge>
      )}
      {speed !== 1 && <Badge variant="secondary">Camera speed ×{speed}</Badge>}
    </div>
  )
}

export function Viewport() {
  return (
    <div
      // [&_canvas]: the canvas element always fills the container, even on frames where its
      // drawing buffer is still the previous size (it stretches briefly instead of leaving a gap).
      className="relative h-full w-full outline-none [&_canvas]:h-full! [&_canvas]:w-full!"
      tabIndex={-1}
      data-viewport
      onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })}
    >
      <Canvas
        camera={{ fov: 60, near: 5, far: 2_000_000, position: [1500, 1200, 1500] }}
        gl={{ antialias: true, logarithmicDepthBuffer: true }}
      >
        <ViewportBackground />
        <SmoothResize />
        <ambientLight intensity={0.6} />
        <hemisphereLight args={["#dfe8ff", "#30302a", 0.8]} />
        <directionalLight position={[3000, 8000, 2000]} intensity={1.6} />
        <ViewportGrid />
        <MapItems />
        <SelectionBox />
        <GizmoController />
        <ClickSelect />
        <FlyCamera />
      </Canvas>
      <Overlay />
      <ToolBar />
    </div>
  )
}

/** Moves keyboard focus to the viewport so editor keybinds apply. */
export const focusViewport = (): void => {
  const el = document.querySelector<HTMLElement>("[data-viewport]")
  el?.focus({ preventScroll: true })
}
