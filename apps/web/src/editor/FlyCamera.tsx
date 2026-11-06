import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useRef } from "react"
import * as THREE from "three"
import { threeToUeVector } from "../domain/coords"
import { flyingActions, formsChord, type MovementAction } from "../domain/flyKeys"
import {
  type Bindings,
  chordOf,
  HeldKeys,
  isBound,
  isBoundChord,
  isOneShotChord,
  type Keybinds,
  mouseChordOf,
  wheelChordOf
} from "../domain/Keybinds"
import { wheelZoomFactor } from "../domain/orthoView"
import { placeDistanceFor, placementPoint } from "../domain/placement"
import { isEditorKeyEvent } from "./keyTargets"
import {
  activePaneCamera,
  FOCUS_SPAN,
  forgetClosedTabs,
  mapBox,
  type PaneCamera,
  paneCamerasOf,
  panePointer
} from "./paneCameras"
import { sceneRegistry } from "./sceneRegistry"
import { useEditor } from "./store"

const FAST_MULTIPLIER = 4
const LOOK_SENSITIVITY = 0.0025 // radians per pixel at sensitivity 1
const KEY_LOOK_SPEED = 1.6 // radians per second for the arrow-key look actions
const ORTHO_KEY_ZOOM = 1.5 // e-foldings per second for the forward and reverse keys in an orthographic pane
const LOCK_SETTLE_MS = 50 // moves dropped after a pointer lock is asked for, taken or lost
const CHORD_MODIFIERS = ["ControlLeft", "ControlRight", "MetaLeft", "MetaRight", "AltLeft", "AltRight"]
const clampPitch = (pitch: number) => THREE.MathUtils.clamp(pitch, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001)

type DragMode = "look" | "orbit" | "pan"

/** The movement actions flying the camera now, per the "movement keys need look" setting. */
const flyingNow = (keybinds: Keybinds, keys: HeldKeys, looking: boolean, now: number) =>
  flyingActions(
    keybinds,
    useEditor.getState().settings.camera.movementNeedsLook,
    looking,
    (binding) => keys.holds(binding, now)
  )

/**
 * Free-fly camera for the panes (docs/DESKTOP.md § View panes): drags and the wheel drive the pane under the pointer, the
 * keys the active pane, every binding from the keybind store. The wheel is camera speed by default, dolly when unbound.
 */
export function FlyCamera() {
  const gl = useThree((s) => s.gl)
  const keybinds = useEditor((s) => s.keybinds)
  const cameraSettings = useEditor((s) => s.settings.camera)
  const focusRequest = useEditor((s) => s.focusRequest)

  const pressed = useRef(new HeldKeys())
  const drag = useRef<DragMode | null>(null)
  /** The pane a drag started in, which it stays with. */
  const dragPane = useRef<PaneCamera | null>(null)
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"))

  useEffect(() => {
    sceneRegistry.toggledProjection = () => {
      const pane = activePaneCamera()
      return pane.view === undefined ? pane.nearestView() : "perspective"
    }
    // Placement point: an orthographic pane's centre; else on the screen-centre ray, at the floor or a cap that fits the piece.
    sceneRegistry.placementPoint = (footprint) => {
      const { floorHeight, settings } = useEditor.getState()
      const pane = activePaneCamera()
      const centre = pane.orthographicPlacement(floorHeight)
      if (centre !== undefined) return centre
      const camera = pane.perspective
      const vertical = THREE.MathUtils.degToRad(camera.fov)
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect)
      return placementPoint(
        threeToUeVector(camera.position),
        threeToUeVector(camera.getWorldDirection(new THREE.Vector3())),
        floorHeight,
        placeDistanceFor(footprint, Math.min(vertical, horizontal), settings.editor.placeDistance)
      )
    }
    // What a prefab spawns in front of. An orthographic pane has no distance to speak of, so it looks from the view's centre.
    sceneRegistry.viewRay = () => {
      const pane = activePaneCamera()
      const direction = threeToUeVector(pane.camera.getWorldDirection(new THREE.Vector3()))
      const centre = pane.orthographicPlacement(useEditor.getState().floorHeight)
      return { origin: centre ?? threeToUeVector(pane.perspective.position), direction }
    }
  }, [])

  useEffect(() => {
    const el = gl.domElement
    const dragModes: ReadonlyArray<readonly [Bindings, DragMode]> = [
      [keybinds.look, "look"],
      [keybinds.orbit, "orbit"],
      [keybinds.pan, "pan"]
    ]
    sceneRegistry.isNavigationChord = (chord) => dragModes.some(([bindings]) => bindings.includes(chord))
    sceneRegistry.lookDragActive = () => drag.current !== null
    sceneRegistry.flyKeysActive = () =>
      flyingNow(keybinds, pressed.current, drag.current !== null, performance.now()).size > 0

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditorKeyEvent(e)) {
        pressed.current.press(e.code, performance.now(), formsChord(keybinds, chordOf(e)))
      }
    }

    // Pointer lock (the "lock pointer" setting) hides the cursor and keeps it in place while
    // dragging, so a long look never hits the edge of the screen. Locking releases the pointer
    // capture; losing the lock mid-drag (Esc) takes the capture back. Browsers report the
    // cursor's jump into and out of the lock as movement, so moves are dropped around a change.
    let dragPointer: number | null = null
    let settleUntil = 0
    const settle = () => {
      settleUntil = performance.now() + LOCK_SETTLE_MS
    }
    const locked = () => document.pointerLockElement === el
    const wantsLock = () => {
      const mode = useEditor.getState().settings.camera.lockPointer
      return mode === "always" || (mode === "desktop" && window.ballest !== undefined)
    }
    // Raw input where the browser has it: Firefox rounds each locked move to whole pixels, so
    // slow diagonals come out as staircases. Denied (no support, the Esc cool-down) is fine:
    // the drag carries on with the capture. Safari returns no promise and ignores the option.
    const lock = () => {
      settle()
      void Promise.resolve(el.requestPointerLock({ unadjustedMovement: true })).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "NotSupportedError" && drag.current !== null) {
          void Promise.resolve(el.requestPointerLock()).catch(() => undefined)
        }
      })
    }
    const onLockChange = () => {
      settle()
      if (locked()) {
        // granted after a quick click was already released
        if (drag.current === null) document.exitPointerLock()
      } else if (dragPointer !== null && !el.hasPointerCapture(dragPointer)) {
        el.setPointerCapture(dragPointer)
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      const { pane, slot } = panePointer(el, e)
      useEditor.getState().setActivePane(slot)
      // No gizmo check: the gizmo stops the left presses it takes, other buttons fall through.
      const chord = mouseChordOf(e)
      // Ctrl+click and the like: the held modifier is the click's, not "down".
      if (isBoundChord(keybinds, chord)) pressed.current.suppressModifiers()
      const mode = dragModes.find(([bindings]) => bindings.includes(chord))?.[1]
      if (mode === undefined) return
      drag.current = pane.view === undefined ? mode : "pan"
      dragPane.current = pane
      const camera = pane.perspective
      if (drag.current === "orbit") pane.keepPivotAhead()
      dragPointer = e.pointerId
      el.setPointerCapture(e.pointerId)
      if (wantsLock()) lock()
      euler.current.setFromQuaternion(camera.quaternion, "YXZ")
      e.preventDefault()
    }
    const onPointerMove = (e: PointerEvent) => {
      const pane = dragPane.current
      if (drag.current === null || pane === null) {
        if (e.buttons === 0) useEditor.getState().setActivePane(panePointer(el, e).slot)
        return
      }
      if (performance.now() < settleUntil) return
      if (pane.view !== undefined) {
        // the point under the pointer stays under it
        pane.slide(-e.movementX * pane.cmPerPixel, e.movementY * pane.cmPerPixel)
        return
      }
      const camera = pane.perspective
      const { target } = pane
      if (drag.current === "pan") {
        const scale = Math.max(1, camera.position.distanceTo(target) * 0.0015)
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
        const step = right.multiplyScalar(-e.movementX * scale).add(up.multiplyScalar(e.movementY * scale))
        camera.position.add(step)
        target.add(step)
        return
      }
      const eul = euler.current
      const { lookSensitivity, invertLookX, invertLookY } = useEditor.getState().settings.camera
      const k = LOOK_SENSITIVITY * lookSensitivity
      eul.y -= e.movementX * k * (invertLookX ? -1 : 1)
      eul.x = clampPitch(eul.x - e.movementY * k * (invertLookY ? -1 : 1))
      eul.z = 0
      const distance = camera.position.distanceTo(target)
      camera.quaternion.setFromEuler(eul)
      if (drag.current === "orbit") {
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion)
        camera.position.copy(target).addScaledVector(back, distance)
      }
    }
    const onPointerUp = (e: PointerEvent) => {
      if (drag.current === null) return
      drag.current = null
      dragPane.current = null
      dragPointer = null
      if (locked()) document.exitPointerLock()
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { pane, px } = panePointer(el, e)
      if (pane.view !== undefined) {
        pane.zoomOrthographic(wheelZoomFactor(e.deltaY), px)
        return
      }
      const chord = wheelChordOf(e)
      const speedStep = isBound(keybinds, "speedFaster", chord) ? 1 : isBound(keybinds, "speedSlower", chord) ? -1 : 0
      if (speedStep !== 0) {
        useEditor.getState().changeSpeed(speedStep)
        return
      }
      const camera = pane.perspective
      const forward = camera.getWorldDirection(new THREE.Vector3())
      const step = -Math.sign(e.deltaY) * Math.max(50, camera.position.distanceTo(pane.target) * 0.1)
      camera.position.addScaledVector(forward, step)
    }

    const listening = new AbortController()
    const { signal } = listening
    window.addEventListener("keydown", onKeyDown, { signal })
    window.addEventListener("keyup", (e) => pressed.current.release(e.code), { signal })
    window.addEventListener("blur", () => pressed.current.clear(), { signal })
    el.addEventListener("pointerdown", onPointerDown, { signal })
    el.addEventListener("pointermove", onPointerMove, { signal })
    el.addEventListener("pointerup", onPointerUp, { signal })
    el.addEventListener("contextmenu", (e) => e.preventDefault(), { signal })
    el.addEventListener("wheel", onWheel, { passive: false, signal })
    document.addEventListener("pointerlockchange", onLockChange, { signal })
    return () => {
      listening.abort()
      if (locked()) document.exitPointerLock()
    }
  }, [gl, keybinds])

  // Focus selection, in the active pane
  useEffect(() => {
    if (focusRequest === 0) return
    const box = new THREE.Box3()
    for (const id of useEditor.getState().selectedIds) {
      const object = sceneRegistry.objects.get(id)
      if (object !== undefined) box.expandByObject(object)
    }
    if (!box.isEmpty()) activePaneCamera().frame(box, FOCUS_SPAN)
  }, [focusRequest])

  // Frame all acts on the active pane; a map put into the tab frames in all of them. Each tab keeps its panes' views,
  // and a tab not seen yet gets new ones, framed as they show.
  useEffect(() =>
    useEditor.subscribe((s, prev) => {
      if (s.tabIds !== prev.tabIds) forgetClosedTabs(s.tabIds)
      if (s.frameAllRequest !== prev.frameAllRequest) activePaneCamera().frameMap(mapBox())
      if (s.mapShownRequest !== prev.mapShownRequest) {
        for (const pane of paneCamerasOf(s.tabId)) pane.needsFraming = true
      }
    }), [])

  useFrame((_, delta) => {
    const keys = pressed.current
    const now = performance.now()
    // Non-movement held keys (arrow look, fast) that are also tool shortcuts only count while
    // looking; movement keys follow the "movement keys need look" setting (see flyKeys).
    const looking = drag.current !== null
    const held = (bindings: Bindings) =>
      bindings.some((binding) => keys.holds(binding, now) && (looking || !isOneShotChord(keybinds, binding)))
    const dt = Math.min(delta, 0.1)
    const pane = activePaneCamera()
    const camera = pane.perspective

    // Arrow-key look (the game's "look right/left/up/down"); an orthographic pane has only the one way to look.
    const yaw = (held(keybinds.lookLeft) ? 1 : 0) - (held(keybinds.lookRight) ? 1 : 0)
    const pitch = (held(keybinds.lookUp) ? 1 : 0) - (held(keybinds.lookDown) ? 1 : 0)
    if ((yaw !== 0 || pitch !== 0) && drag.current === null && pane.view === undefined) {
      const eul = euler.current.setFromQuaternion(camera.quaternion, "YXZ")
      const rate = KEY_LOOK_SPEED * cameraSettings.lookSensitivity * dt
      eul.y += yaw * rate
      eul.x = clampPitch(eul.x + pitch * rate)
      eul.z = 0
      camera.quaternion.setFromEuler(eul)
    }

    const flying = flyingNow(keybinds, keys, looking, now)
    const axis = (plus: MovementAction, minus: MovementAction) =>
      (flying.has(plus) ? 1 : 0) - (flying.has(minus) ? 1 : 0)
    const move = new THREE.Vector3(
      axis("moveRight", "moveLeft"),
      axis("moveUp", "moveDown"),
      axis("moveBack", "moveForward")
    )
    if (move.lengthSq() === 0) return
    // Keys held together with Ctrl/Alt are chords (Ctrl+S...), not movement.
    if (CHORD_MODIFIERS.some((code) => keys.has(code)) && move.y === 0) return
    const { cameraSpeed } = useEditor.getState()
    const speed = cameraSettings.flySpeed * cameraSpeed * (held(keybinds.fastMove) ? FAST_MULTIPLIER : 1) * dt
    if (pane.view !== undefined) {
      pane.slide(move.x * speed, move.y * speed)
      if (move.z !== 0) {
        pane.zoomOrthographic(Math.exp(move.z * ORTHO_KEY_ZOOM * dt), { x: pane.width / 2, y: pane.height / 2 })
      }
      return
    }
    const horizontal = new THREE.Vector3(move.x, 0, move.z).applyQuaternion(camera.quaternion)
    const step = horizontal.add(new THREE.Vector3(0, move.y, 0)).normalize().multiplyScalar(speed)
    camera.position.add(step)
    pane.target.add(step)
  })

  return null
}
