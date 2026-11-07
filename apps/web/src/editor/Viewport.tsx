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
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react"
import * as THREE from "three"
import type { CatalogPiece } from "../domain/Catalog"
import { threeToUeVector, toTuple3, ueToThreeVector } from "../domain/coords"
import { counted, groupBoxTargets } from "../domain/groupSelection"
import { isBound, mouseChordOf } from "../domain/Keybinds"
import { WATER } from "../domain/level"
import { dropPoint, pieceFootprint } from "../domain/placement"
import { ORTHO_GROUND, SCENE_COLORS } from "../domain/sceneGround"
import { gridColorsOf } from "../domain/Settings"
import { holdsDrop, placeAt, placePrefab, placeSnapped } from "./actions"
import { fadeFineLines, gridReach } from "./floorGrid"
import { FlyCamera } from "./FlyCamera"
import { GizmoController } from "./gizmo/GizmoController"
import { GroupBox } from "./groupBox"
import { ItemObject } from "./ItemObject"
import { advanceGameTime } from "./materials"
import { OrthoGrid } from "./OrthoGrid"
import { floorGridOnly, panePointer } from "./paneCameras"
import { drawEveryPane, PaneRenderer, useBeforePaneDraw } from "./PaneRenderer"
import { draggedPiece, isPieceDrag } from "./pieceDrag"
import { PivotDot } from "./pivotDot"
import { droppedPrefab, isPrefabDrag } from "./prefabDrag"
import { originLabelTexture, PrefabOrigin } from "./prefabOrigin"
import { GROUP_BOX_COLORS, sceneBackgroundClass } from "./sceneColors"
import { SceneLights } from "./SceneLights"
import { sceneRegistry } from "./sceneRegistry"
import { SelectionOutline, setOutlineTheme } from "./selectionOutline"
import { SKY_DOME_RADIUS } from "./sky"
import { endSnapDisplay } from "./snap/moveSession"
import { showDrop, snappedDrop } from "./snap/pieceDrop"
import { SnapInput } from "./snap/SnapInput"
import { SnapOverlay } from "./snap/SnapOverlay"
import { groupBoxOf, noTabOpen, type SelectMode, shownPivotDots, snapConfigOf, useEditor, useOpenPrefab } from "./store"
import { useDarkTheme } from "./theme"
import { isMesh } from "./threeGuards"
import { glbUrl, visualsOf } from "./visuals"
import { setWaterShown, setWaterTheme, waterTopMaterial, waterUnderMaterial } from "./water"

const CLICK_SLOP_PX = 4

/** The floor grid's cells with no snapping to show: 1 m, with 10 m sections. */
const FLOOR_CELL_CM = 100

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
const selectModeOf = (e: MouseEvent): SelectMode | null => {
  if (e.button !== 0) return null
  const chord = mouseChordOf(e)
  const { keybinds } = useEditor.getState()
  if (isBound(keybinds, "toggleSelection", chord)) return "toggle"
  if (isBound(keybinds, "addToSelection", chord)) return "add"
  return sceneRegistry.isNavigationChord(chord) ? null : "replace"
}

/**
 * Left-click selection, with the add/toggle modifiers, via a manual raycast on click only
 * (cheap for maps with thousands of items). A click reaches the store's click level; a plain
 * double-click on the same spot enters a group.
 */
function ClickSelect() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()
    let down: { x: number; y: number; mode: SelectMode; slot: number } | null = null
    let clicked = false
    const itemAt = (e: MouseEvent, slot?: number): string | null => {
      const { ndc, pane } = panePointer(el, e, slot)
      raycaster.setFromCamera(ndc, pane.camera)
      const root = sceneRegistry.itemsRoot
      return hitItemId(root === null ? [] : raycaster.intersectObject(root, true))
    }
    const onDown = (e: PointerEvent) => {
      const mode = selectModeOf(e)
      down = mode !== null && !sceneRegistry.gizmoActive()
        ? { x: e.clientX, y: e.clientY, mode, slot: panePointer(el, e).slot }
        : null
      clicked = false
    }
    const onUp = (e: PointerEvent) => {
      if (down === null || e.button !== 0) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      const { mode, slot } = down
      down = null
      if (moved > CLICK_SLOP_PX || sceneRegistry.gizmoActive()) return
      clicked = mode === "replace"
      useEditor.getState().clickItem(itemAt(e, slot), mode)
    }
    const onDoubleClick = (e: MouseEvent) => {
      if (!clicked) return
      const key = itemAt(e)
      if (key !== null) useEditor.getState().doubleClickItem(key)
    }
    const listening = new AbortController()
    const { signal } = listening
    el.addEventListener("pointerdown", onDown, { signal })
    el.addEventListener("pointerup", onUp, { signal })
    el.addEventListener("dblclick", onDoubleClick, { signal })
    return () => listening.abort()
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
 * What's under a pointer dragging `piece`: the item it is over, else the floor, or in an orthographic view the plane a
 * click would place on. The raycast is here rather than on every drag event, for the same reason as a click's.
 */
const dropTarget = (piece: CatalogPiece, canvas: HTMLElement, e: { clientX: number; clientY: number }) => {
  const { ndc, pane, px, slot } = panePointer(canvas, e)
  const { floorHeight, settings } = useEditor.getState()
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndc, pane.camera)
  const { ray } = raycaster
  const root = sceneRegistry.itemsRoot
  const surface = (root === null ? [] : raycaster.intersectObject(root, true)).flatMap((hit) => {
    const id = isMesh(hit.object) ? hitItemId([hit]) : null
    return id !== null && holdsDrop(id) ? [{ id, point: hit.point }] : []
  })[0]
  const point = surface !== undefined
    ? threeToUeVector(surface.point)
    : pane.orthographicPlacement(floorHeight, ray.closestPointToPoint(pane.target, new THREE.Vector3())) ??
      dropPoint(
        threeToUeVector(ray.origin),
        threeToUeVector(ray.direction),
        floorHeight,
        SKY_DOME_RADIUS,
        pane.placeDistance(pieceFootprint(piece), settings.editor.placeDistance)
      )
  return { pane, px, slot, point, surface: surface?.id }
}

/** Places `piece` under a pointer, on what snapping lands it on, else on what `dropTarget` found, clear of any other item. */
const dropPiece = (
  piece: CatalogPiece,
  canvas: HTMLElement,
  e: { clientX: number; clientY: number; ctrlKey: boolean }
) => {
  const { pane, point, px, slot, surface } = dropTarget(piece, canvas, e)
  const s = useEditor.getState()
  s.setActivePane(slot)
  const snapped = snappedDrop(s, piece, pane, px, point, e.ctrlKey)
  endSnapDisplay()
  if (snapped !== undefined) placeSnapped(piece, snapped.transform, snapped.options)
  else placeAt(piece, point, pane.placementView(), surface)
}

/** Shows where a piece on its way would land. */
const showPieceDrop = (
  piece: CatalogPiece,
  canvas: HTMLElement,
  e: { clientX: number; clientY: number; ctrlKey: boolean }
) => {
  const { pane, point, px } = dropTarget(piece, canvas, e)
  const s = useEditor.getState()
  showDrop(s, snappedDrop(s, piece, pane, px, point, e.ctrlKey))
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

/** The clear colour follows the theme and the pane's projection, and the container behind the canvas the theme (sceneBackgroundClass). */
function ViewportBackground() {
  const gl = useThree((s) => s.gl)
  const theme = useDarkTheme(useEditor((s) => s.settings.appearance.theme)) ? "dark" : "light"
  useBeforePaneDraw(({ view }) => gl.setClearColor((view === undefined ? SCENE_COLORS : ORTHO_GROUND)[theme]))
  return null
}

/**
 * The floor grid (1 m cells, 10 m sections) at the map's floor height, in the user's
 * colours or ones derived from the ground they sit on. It follows the camera, so it ends where its fade ends.
 */
function ViewportGrid() {
  const appearance = useEditor((s) => s.settings.appearance)
  const floorHeight = useEditor((s) => s.floorHeight)
  const dark = useDarkTheme(appearance.theme)
  const colors = gridColorsOf(appearance, dark)
  const snapping = useEditor(snapConfigOf)
  const { origin, yaw } = snapping.targets.grid
  // what is seen is what snaps: the grid's own step while it is on, from its origin and turned with it
  const step = snapping.enabled && snapping.targets.grid.enabled ? snapping.gridSize : FLOOR_CELL_CM
  const grid = useRef<THREE.Mesh>(null)
  useLayoutEffect(() => {
    const material = grid.current?.material
    if (!(material instanceof THREE.ShaderMaterial)) return
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = fadeFineLines(shader.fragmentShader)
    }
    material.needsUpdate = true
  }, [])
  // drei fades the grid from R3F's camera, and each pane has its own.
  useBeforePaneDraw(({ perspective: { position } }) => {
    const material = grid.current?.material
    if (!(material instanceof THREE.ShaderMaterial)) return
    const fadeFrom: unknown = material.uniforms["worldCamProjPosition"]?.value
    if (fadeFrom instanceof THREE.Vector3) fadeFrom.set(position.x, floorHeight, position.z)
    const fadeDistance = material.uniforms["fadeDistance"]
    if (fadeDistance !== undefined) fadeDistance.value = gridReach(position.y - floorHeight, SKY_DOME_RADIUS)
    material.uniformsNeedUpdate = true
  })
  return (
    <Grid
      ref={grid}
      layers={floorGridOnly}
      visible={appearance.gridVisible}
      position={toTuple3(ueToThreeVector({ ...origin, z: floorHeight }))}
      rotation={[0, -yaw * Math.PI / 180, 0]}
      side={THREE.DoubleSide} // drei's default (BackSide) hides it from below
      infiniteGrid
      followCamera // with the plane below, the grid has no edge to see: it ends where its fade does, wherever the camera is
      args={[2, 2]} // drei scales this by the fade distance, and the 1 x 1 default stops at half of it, still visible
      cellSize={step}
      sectionSize={step * 10}
      fadeDistance={SKY_DOME_RADIUS}
      fadeStrength={2}
      cellThickness={1} // drei's half-pixel default makes the 1 m lines unreadable in the light theme
      cellColor={colors.cell}
      sectionColor={colors.section}
    />
  )
}

const WATER_POSITION = toTuple3(ueToThreeVector({ ...WATER.center, z: WATER.height }))

/** The level's water sheet (see water.ts). Not in the click raycast (that only walks the items). */
function Water() {
  const appearance = useEditor((s) => s.settings.appearance)
  const dark = useDarkTheme(appearance.theme)
  useEffect(() => setWaterTheme(dark ? "dark" : "light"), [dark])
  useEffect(() => setWaterShown(appearance.waterVisible), [appearance.waterVisible])
  const geometry = useMemo(() => new THREE.PlaneGeometry(WATER.size, WATER.size), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  if (!appearance.waterVisible) return null
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

/** Outline along a selected item's mesh edges (see selectionOutline.ts); the active item draws apart. */
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
  const dark = useDarkTheme(useEditor((s) => s.settings.appearance.theme))
  useEffect(() => setOutlineTheme(dark), [dark])
  const active = selectedIds.at(-1)
  return selectedIds.map((id) => <SelectedOutline key={id} id={id} active={id === active} />)
}

/** A whole group's box (see groupBox.ts), following its items. */
function GroupBoxView({ keys, entered }: { readonly keys: ReadonlyArray<string>; readonly entered: boolean }) {
  const box = useMemo(() => new GroupBox(), [])
  const dark = useDarkTheme(useEditor((s) => s.settings.appearance.theme))
  useEffect(() => box.setLook(dark ? GROUP_BOX_COLORS.dark : GROUP_BOX_COLORS.light, entered), [box, dark, entered])
  useEffect(() => () => box.dispose(), [box])
  const doc = useEditor((s) => s.doc)
  const preview = useEditor((s) => s.preview)
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const bounds = useMemo(() => groupBoxOf({ doc, preview, catalogIndex }, keys), [doc, preview, catalogIndex, keys])
  useFrame(({ camera, size }) => box.update(bounds, camera, size.height))
  return <primitive object={box} />
}

/**
 * The dots at the selection's pivots (editor/pivotDot.ts): one in Together, one per unit in Each. Placed for each pane's
 * camera just before it draws, like the gizmo, so they stay a steady size and face every pane.
 */
function PivotDots() {
  const dark = useDarkTheme(useEditor((s) => s.settings.appearance.theme))
  const dots = useMemo(() => new THREE.Group(), [])
  const pool = useRef<Array<PivotDot>>([])
  useEffect(() => () => {
    for (const dot of pool.current) dot.dispose()
    pool.current = []
  }, [])
  useEffect(() => {
    for (const dot of pool.current) dot.setDark(dark)
  }, [dark])
  useBeforePaneDraw((pane) => {
    const specs = shownPivotDots(useEditor.getState())
    while (pool.current.length < specs.length) {
      const dot = new PivotDot()
      dot.setDark(dark)
      pool.current.push(dot)
      dots.add(dot)
    }
    pool.current.forEach((dot, i) => {
      const spec = specs[i]
      dot.visible = spec !== undefined
      if (spec === undefined) return
      const w = ueToThreeVector(spec.pivot)
      const origin = new THREE.Vector3(w.x, w.y, w.z)
      dot.update(origin, pane.worldPerPixelAt(origin), pane.camera.quaternion, spec.inside)
    })
  })
  return <primitive object={dots} />
}

function GroupBoxes() {
  const tree = useEditor((s) => s.doc.structure.tree)
  const selectedIds = useEditor((s) => s.selectedIds)
  const enteredGroupId = useEditor((s) => s.enteredGroupId)
  const targets = useMemo(() => groupBoxTargets(tree, selectedIds, enteredGroupId), [tree, selectedIds, enteredGroupId])
  return targets.map(({ id, keys, entered }) => <GroupBoxView key={id} keys={keys} entered={entered} />)
}

/** The prefab's (0, 0, 0), in a definition's tab alone (see prefabOrigin.ts). */
function PrefabOriginMarker() {
  const marker = useMemo(() => new PrefabOrigin(originLabelTexture()), [])
  const dark = useDarkTheme(useEditor((s) => s.settings.appearance.theme))
  useEffect(() => marker.setDark(dark), [marker, dark])
  useEffect(() => () => marker.dispose(), [marker])
  useBeforePaneDraw((pane) => marker.fitTo(pane.worldPerPixelAt(marker.position)))
  return <primitive object={marker} visible={useOpenPrefab() !== null} />
}

function Overlay() {
  const missing = useEditor((s) => s.missingGlbs)
  const speed = useEditor((s) => s.cameraSpeed)
  return (
    // The viewport's bottom left, which nothing else uses: neither of these belongs to a pane. Over the tool bar's height
    // in a viewport too narrow to hold them beside it.
    <div className="pointer-events-none absolute inset-0 @container">
      <div className="absolute bottom-3 left-3 flex flex-col items-start gap-1.5 @max-[35rem]:bottom-14">
        {missing.size > 0 && (
          <Badge variant="destructive" className="pointer-events-auto" title={[...missing].join("\n")}>
            {counted(missing.size, "mesh file")} failed to load
          </Badge>
        )}
        {speed !== 1 && <Badge variant="neutral">Camera speed ×{speed}</Badge>}
      </div>
    </div>
  )
}

/** `controls` (tool bar, view controls) floats over the scene; it is disabled until the first scene shows. */
export function Viewport({ controls: Controls }: { readonly controls: ComponentType<{ readonly disabled: boolean }> }) {
  const [revealed, setRevealed] = useState(false)
  const reveal = useCallback(() => setRevealed(true), [])
  const hidden = useEditor(noTabOpen)
  return (
    <div
      // [&_canvas]: the canvas element always fills the container, even on frames where its
      // drawing buffer is still the previous size (it stretches briefly instead of leaving a gap).
      className={cn("relative h-full w-full outline-none [&_canvas]:h-full! [&_canvas]:w-full!", sceneBackgroundClass)}
      tabIndex={-1}
      data-viewport
      onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })}
      onDragOver={(e) => {
        if (!isPrefabDrag(e.dataTransfer) && !isPieceDrag(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
        const piece = isPieceDrag(e.dataTransfer) ? draggedPiece() : undefined
        const canvas = e.currentTarget.querySelector("canvas")
        if (piece !== undefined && canvas !== null) showPieceDrop(piece, canvas, e)
      }}
      onDragLeave={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) endSnapDisplay()
      }}
      onDrop={(e) => {
        const prefab = droppedPrefab(e.dataTransfer)
        const piece = isPieceDrag(e.dataTransfer) ? draggedPiece() : undefined
        const canvas = e.currentTarget.querySelector("canvas")
        if (prefab === undefined && (piece === undefined || canvas === null)) return
        e.preventDefault()
        e.currentTarget.focus({ preventScroll: true })
        if (prefab !== undefined) void placePrefab(prefab)
        else if (piece !== undefined && canvas !== null) dropPiece(piece, canvas, e)
      }}
    >
      <Canvas
        frameloop={hidden ? "never" : "always"}
        // Hidden until the first scene is ready, then a quick fade up from translucent.
        className={revealed ? "animate-in fade-in-30 duration-150 ease-out" : "opacity-0"}
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
        <GroupBoxes />
        <PrefabOriginMarker />
        <PivotDots />
        <SnapOverlay />
        <GizmoController />
        <SnapInput />
        <ClickSelect />
        <FlyCamera />
        <PaneRenderer />
        {!revealed && <InitialMeshes onSettled={reveal} />}
      </Canvas>
      <Overlay />
      <Controls disabled={!revealed} />
    </div>
  )
}

/** Moves keyboard focus to the viewport so editor keybinds apply. */
export const focusViewport = (): void => {
  const el = document.querySelector<HTMLElement>("[data-viewport]")
  el?.focus({ preventScroll: true })
}
