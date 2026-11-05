import { Grid, useGLTF } from "@react-three/drei"
import { Canvas, useFrame, useStore, useThree } from "@react-three/fiber"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"
import {
  Component,
  type ComponentType,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"
import * as THREE from "three"
import { toTuple3, ueToThreeVector } from "../domain/coords"
import { isBound, mouseChordOf } from "../domain/Keybinds"
import { WATER } from "../domain/level"
import { gridColorsOf } from "../domain/Settings"
import { FlyCamera } from "./FlyCamera"
import { GizmoController } from "./gizmo/GizmoController"
import { ItemObject } from "./ItemObject"
import { advanceGameTime } from "./materials"
import { OrthoGrid } from "./OrthoGrid"
import { panePointer, perspectiveOnly } from "./paneCameras"
import { drawEveryPane, PaneRenderer, useBeforePaneDraw } from "./PaneRenderer"
import { SCENE_COLORS, sceneBackgroundClass } from "./sceneColors"
import { SceneLights } from "./SceneLights"
import { sceneRegistry } from "./sceneRegistry"
import { SelectionOutline } from "./selectionOutline"
import { SKY_DOME_RADIUS } from "./sky"
import { nextSelection, type SelectMode, useEditor } from "./store"
import { useDarkTheme } from "./theme"
import { glbUrl, visualsOf } from "./visuals"
import { waterTopMaterial, waterUnderMaterial } from "./water"

const CLICK_SLOP_PX = 4

function MapItems() {
  const doc = useEditor((s) => s.doc)
  const index = useEditor((s) => s.catalogIndex)
  // Without the catalog every item would draw as an unknown-mesh warning box, so wait for it
  // (unless it failed to load, when those boxes are the truth).
  const booting = useEditor((s) => s.booting)
  const root = useRef<THREE.Group>(null)
  useEffect(() => {
    sceneRegistry.itemsRoot = root.current
  }, [])
  return (
    <group ref={root} matrixAutoUpdate={false}>
      {(index !== null || !booting) &&
        doc.map.items.map((item, i) => {
          const id = doc.ids[i]
          return id === undefined ? null : <ItemObject key={id} id={id} item={item} index={index} />
        })}
    </group>
  )
}

/** Suspends until `url` is in drei's glb cache, the same entry ItemObject reads. */
function CachedGlb({ url }: { readonly url: string }) {
  useGLTF(url)
  return null
}

function OnCommit({ run }: { readonly run: () => void }) {
  useEffect(run, [run])
  return null
}

/** A failed glb still settles the wait: its item draws a warning box. */
class SettleOnError
  extends Component<{ readonly onSettled: () => void; readonly children: ReactNode }, { readonly failed: boolean }>
{
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch() {
    this.props.onSettled()
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * Calls `onSettled` once the startup loads are done and every mesh of the map on screen at
 * that point is in the cache. Until then the viewport keeps the scene hidden, so it appears
 * once, complete, instead of stepping through stand-in boxes and loading wireframes. Later
 * loads (imports, placed pieces) show their loading hints as usual.
 */
function InitialMeshes({ onSettled }: { readonly onSettled: () => void }) {
  const booting = useEditor((s) => s.booting)
  return booting ? null : <StartingMapMeshes onSettled={onSettled} />
}

/** Mounted when booting ends; the map on screen at that moment is what the reveal waits for. */
function StartingMapMeshes({ onSettled }: { readonly onSettled: () => void }) {
  const index = useEditor((s) => s.catalogIndex)
  const items = useEditor((s) => s.doc.map.items)
  const [urls] = useState(() => [
    ...new Set(items.flatMap((item) => visualsOf(item, index).flatMap((v) => glbUrl(v.mesh?.glb) ?? [])))
  ])
  return (
    <SettleOnError onSettled={onSettled}>
      <Suspense fallback={null}>
        {urls.map((url) => <CachedGlb key={url} url={url} />)}
        <OnCommit run={onSettled} />
      </Suspense>
    </SettleOnError>
  )
}

/**
 * How a left click selects, from its chord: the add/toggle selection bindings, else a
 * plain click. Null when the chord drives the camera instead (Alt+LMB orbit).
 */
const selectModeOf = (e: PointerEvent): SelectMode | null => {
  if (e.button !== 0) return null
  const chord = mouseChordOf(e)
  const { keybinds } = useEditor.getState()
  if (isBound(keybinds, "toggleSelection", chord)) return "toggle"
  if (isBound(keybinds, "addToSelection", chord)) return "add"
  return sceneRegistry.isNavigationChord(chord) ? null : "replace"
}

/**
 * Left-click selection, with the add/toggle modifiers, via a manual raycast on click only
 * (cheap for maps with thousands of items).
 */
function ClickSelect() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()
    let down: { x: number; y: number; mode: SelectMode; slot: number } | null = null
    const onDown = (e: PointerEvent) => {
      const mode = selectModeOf(e)
      down = mode !== null && !sceneRegistry.gizmoActive()
        ? { x: e.clientX, y: e.clientY, mode, slot: panePointer(el, e).slot }
        : null
    }
    const onUp = (e: PointerEvent) => {
      if (down === null || e.button !== 0) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      const { mode, slot } = down
      down = null
      if (moved > CLICK_SLOP_PX || sceneRegistry.gizmoActive()) return
      const { ndc, pane } = panePointer(el, e, slot)
      raycaster.setFromCamera(ndc, pane.camera)
      const root = sceneRegistry.itemsRoot
      const hits = root === null ? [] : raycaster.intersectObject(root, true)
      const { selectedIds, select } = useEditor.getState()
      select(nextSelection(selectedIds, hitItemId(hits), mode))
    }
    el.addEventListener("pointerdown", onDown)
    el.addEventListener("pointerup", onUp)
    return () => {
      el.removeEventListener("pointerdown", onDown)
      el.removeEventListener("pointerup", onUp)
    }
  }, [gl])
  return null
}

/** The item under the nearest hit, if any. */
const hitItemId = (hits: ReadonlyArray<THREE.Intersection>): string | null => {
  for (const hit of hits) {
    let o: THREE.Object3D | null = hit.object
    while (o !== null && o.userData["itemId"] === undefined) o = o.parent
    if (o !== null) {
      const itemId: unknown = o.userData["itemId"]
      return typeof itemId === "string" ? itemId : null
    }
  }
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
      if (state.size !== prev.size) drawEveryPane(state)
    })
    return () => {
      observer.disconnect()
      unsubscribe()
    }
  }, [store])
  return null
}

/**
 * Clear colour follows the theme: dark slate, or a light grey in light mode. The container
 * behind the canvas has the same colour (sceneBackgroundClass).
 */
function ViewportBackground() {
  const gl = useThree((s) => s.gl)
  const theme = useEditor((s) => s.settings.appearance.theme)
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches)
      gl.setClearColor(dark ? SCENE_COLORS.dark : SCENE_COLORS.light)
    }
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [gl, theme])
  return null
}

/**
 * The floor grid (1 m cells, 10 m sections) at the map's floor height, in the user's
 * colours or ones picked for what it's seen against (the theme, or the sky by day or night).
 */
function ViewportGrid() {
  const appearance = useEditor((s) => s.settings.appearance)
  const floorHeight = useEditor((s) => s.floorHeight)
  const dark = useDarkTheme(appearance.theme)
  const colors = gridColorsOf(appearance, dark)
  const grid = useRef<THREE.Mesh>(null)
  // drei fades the grid from R3F's camera, and each pane has its own.
  useBeforePaneDraw(({ perspective: { position } }) => {
    const material = grid.current?.material
    if (!(material instanceof THREE.ShaderMaterial)) return
    const fadeFrom: unknown = material.uniforms["worldCamProjPosition"]?.value
    if (fadeFrom instanceof THREE.Vector3) fadeFrom.set(position.x, floorHeight, position.z)
    material.uniformsNeedUpdate = true
  })
  if (!appearance.gridVisible) return null
  return (
    <Grid
      ref={grid}
      layers={perspectiveOnly}
      position={[0, floorHeight, 0]}
      side={THREE.DoubleSide} // drei's default (BackSide) hides it from below
      infiniteGrid
      cellSize={100}
      sectionSize={1000}
      fadeDistance={SKY_DOME_RADIUS}
      fadeStrength={2}
      cellColor={colors.cell}
      sectionColor={colors.section}
    />
  )
}

const WATER_POSITION = toTuple3(ueToThreeVector({ ...WATER.center, z: WATER.height }))

/** The level's water sheet (see water.ts). Not in the click raycast (that only walks the items). */
function Water() {
  const visible = useEditor((s) => s.settings.appearance.waterVisible)
  const geometry = useMemo(() => new THREE.PlaneGeometry(WATER.size, WATER.size), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  if (!visible) return null
  return (
    <group position={WATER_POSITION} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={geometry} material={waterTopMaterial} renderOrder={1} />
      <mesh geometry={geometry} material={waterUnderMaterial} renderOrder={1} />
    </group>
  )
}

/** Runs the clock of the materials that move (the vent's air, the checkpoints' glow). */
function GameClock() {
  useFrame((_, seconds) => advanceGameTime(seconds))
  return null
}

/** Outline along a selected item's mesh edges (see selectionOutline.ts); the active item draws lighter. */
function SelectedOutline({ id, active }: { readonly id: string; readonly active: boolean }) {
  const outline = useMemo(() => new SelectionOutline(), [])
  useFrame(() => {
    const object = sceneRegistry.objects.get(id)
    if (object === undefined) {
      outline.removeFromParent()
      return
    }
    if (outline.parent !== object) object.add(outline)
    outline.update(object, active) // glbs load async, so keep it fresh
  })
  useEffect(() => () => void outline.removeFromParent(), [outline])
  return null
}

function SelectedOutlines() {
  const selectedIds = useEditor((s) => s.selectedIds)
  const active = selectedIds.at(-1)
  return selectedIds.map((id) => <SelectedOutline key={id} id={id} active={id === active} />)
}

function Overlay() {
  const missing = useEditor((s) => s.missingGlbs)
  const speed = useEditor((s) => s.cameraSpeed)
  return (
    <div className="pointer-events-none absolute inset-x-2 top-10 bottom-2 flex flex-col items-start gap-1.5">
      {missing.size > 0 && (
        <Badge variant="destructive" className="pointer-events-auto" title={[...missing].join("\n")}>
          {missing.size} mesh file{missing.size === 1 ? "" : "s"} failed to load
        </Badge>
      )}
      {speed !== 1 && <Badge variant="secondary">Camera speed ×{speed}</Badge>}
    </div>
  )
}

/** `controls` (tool bar, view controls) floats over the scene; it is disabled until the first scene shows. */
export function Viewport(
  { controls: Controls }: { readonly controls?: ComponentType<{ readonly disabled?: boolean }> }
) {
  const [revealed, setRevealed] = useState(false)
  const reveal = useCallback(() => setRevealed(true), [])
  return (
    <div
      // [&_canvas]: the canvas element always fills the container, even on frames where its
      // drawing buffer is still the previous size (it stretches briefly instead of leaving a gap).
      className={cn("relative h-full w-full outline-none [&_canvas]:h-full! [&_canvas]:w-full!", sceneBackgroundClass)}
      tabIndex={-1}
      data-viewport
      onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })}
    >
      <Canvas
        // Hidden until the first scene is ready, then a quick fade up from translucent.
        className={revealed ? "animate-in fade-in-30 duration-300 ease-out" : "opacity-0"}
        // A pane that isn't drawn this frame keeps its pixels (see PaneRenderer).
        gl={{ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true }}
      >
        <ViewportBackground />
        <SmoothResize />
        <GameClock />
        <SceneLights />
        <ViewportGrid />
        <OrthoGrid />
        <Water />
        <MapItems />
        <SelectedOutlines />
        <GizmoController />
        <ClickSelect />
        <FlyCamera />
        <PaneRenderer />
        {!revealed && <InitialMeshes onSettled={reveal} />}
      </Canvas>
      <Overlay />
      {Controls && <Controls disabled={!revealed} />}
    </div>
  )
}

/** Moves keyboard focus to the viewport so editor keybinds apply. */
export const focusViewport = (): void => {
  const el = document.querySelector<HTMLElement>("[data-viewport]")
  el?.focus({ preventScroll: true })
}
