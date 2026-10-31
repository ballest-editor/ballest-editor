import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useRef } from "react"
import * as THREE from "three"
import { threeToUeVector, ueToThreeVector } from "../domain/coords"
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
import { placeDistanceFor, placementPoint } from "../domain/placement"
import { editorVerticalFov } from "../domain/Settings"
import { sceneRegistry } from "./sceneRegistry"
import { useEditor } from "./store"

const FAST_MULTIPLIER = 4
const LOOK_SENSITIVITY = 0.0025 // radians per pixel at sensitivity 1
const KEY_LOOK_SPEED = 1.6 // radians per second for the arrow-key look actions
const ORBIT_DISTANCE = 1500 // orbit pivot ahead of the camera when the old one is behind it
const LOCK_SETTLE_MS = 50 // moves dropped after a pointer lock is asked for, taken or lost

export const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))

/**
 * Keyboard events that belong to a text field, an open dialog or a menu (the menu bar's
 * arrow keys, Escape and type-ahead) never drive the editor.
 */
export const isEditorKeyEvent = (e: KeyboardEvent): boolean =>
  !isTypingTarget(e.target) &&
  useEditor.getState().dialog === null &&
  !(e.target instanceof Element && e.target.closest("[role=dialog], [role=menu], [role=menubar]") !== null)

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
 * Free-fly camera: hold the look button and drag to look, movement keys to fly, orbit and
 * pan drags, and the wheel (camera speed by default, dolly when the wheel is unbound).
 * Every binding comes from the keybind store.
 */
export function FlyCamera() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const keybinds = useEditor((s) => s.keybinds)
  const cameraSettings = useEditor((s) => s.settings.camera)
  const cameraPresets = useEditor((s) => s.keybindDefaults.cameraPresets)
  const focusRequest = useEditor((s) => s.focusRequest)

  const pressed = useRef(new HeldKeys())
  const drag = useRef<DragMode | null>(null)
  const target = useRef(new THREE.Vector3())
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"))

  // Placement point: on the screen-centre ray, at the floor or a cap that fits the piece.
  useEffect(() => {
    sceneRegistry.camera = camera
    sceneRegistry.placementPoint = (footprint) => {
      const { floorHeight, settings } = useEditor.getState()
      const vertical = camera instanceof THREE.PerspectiveCamera ? THREE.MathUtils.degToRad(camera.fov) : Math.PI / 3
      const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect)
      return placementPoint(
        threeToUeVector(camera.position),
        threeToUeVector(camera.getWorldDirection(new THREE.Vector3())),
        floorHeight,
        placeDistanceFor(footprint, Math.min(vertical, horizontal), settings.editor.placeDistance)
      )
    }
  }, [camera])

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
      if (isEditorKeyEvent(e)) pressed.current.press(e.code, performance.now(), formsChord(keybinds, chordOf(e)))
    }
    const onKeyUp = (e: KeyboardEvent) => pressed.current.release(e.code)
    const onBlur = () => pressed.current.clear()

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
      // No gizmo check: the gizmo stops the left presses it takes, other buttons fall through.
      const chord = mouseChordOf(e)
      // Ctrl+click and the like: the held modifier is the click's, not "down".
      if (isBoundChord(keybinds, chord)) pressed.current.suppressModifiers()
      const mode = dragModes.find(([bindings]) => bindings.includes(chord))?.[1]
      if (mode === undefined) return
      drag.current = mode
      if (mode === "orbit") {
        // keep the pivot if it's in front of us, otherwise orbit around a point ahead
        const forward = camera.getWorldDirection(new THREE.Vector3())
        if (target.current.clone().sub(camera.position).dot(forward) <= 0) {
          target.current.copy(camera.position).addScaledVector(forward, ORBIT_DISTANCE)
        }
      }
      dragPointer = e.pointerId
      el.setPointerCapture(e.pointerId)
      if (wantsLock()) lock()
      euler.current.setFromQuaternion(camera.quaternion, "YXZ")
      e.preventDefault()
    }
    const onPointerMove = (e: PointerEvent) => {
      if (drag.current === null) return
      if (performance.now() < settleUntil) return
      if (drag.current === "pan") {
        const scale = Math.max(1, camera.position.distanceTo(target.current) * 0.0015)
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
        const step = right.multiplyScalar(-e.movementX * scale).add(up.multiplyScalar(e.movementY * scale))
        camera.position.add(step)
        target.current.add(step)
        return
      }
      const eul = euler.current
      const { lookSensitivity, invertLookX, invertLookY } = useEditor.getState().settings.camera
      const k = LOOK_SENSITIVITY * lookSensitivity
      eul.y -= e.movementX * k * (invertLookX ? -1 : 1)
      eul.x = THREE.MathUtils.clamp(
        eul.x - e.movementY * k * (invertLookY ? -1 : 1),
        -Math.PI / 2 + 0.001,
        Math.PI / 2 - 0.001
      )
      eul.z = 0
      if (drag.current === "orbit") {
        const distance = camera.position.distanceTo(target.current)
        camera.quaternion.setFromEuler(eul)
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion)
        camera.position.copy(target.current).addScaledVector(back, distance)
      } else {
        camera.quaternion.setFromEuler(eul)
      }
    }
    const onPointerUp = (e: PointerEvent) => {
      if (drag.current === null) return
      drag.current = null
      dragPointer = null
      if (locked()) document.exitPointerLock()
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }
    const onContextMenu = (e: Event) => e.preventDefault()
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const chord = wheelChordOf(e)
      const state = useEditor.getState()
      if (isBound(keybinds, "speedFaster", chord)) {
        state.changeSpeed(1)
        return
      }
      if (isBound(keybinds, "speedSlower", chord)) {
        state.changeSpeed(-1)
        return
      }
      const forward = camera.getWorldDirection(new THREE.Vector3())
      const step = -Math.sign(e.deltaY) * Math.max(50, camera.position.distanceTo(target.current) * 0.1)
      camera.position.addScaledVector(forward, step)
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", onBlur)
    el.addEventListener("pointerdown", onPointerDown)
    el.addEventListener("pointermove", onPointerMove)
    el.addEventListener("pointerup", onPointerUp)
    el.addEventListener("contextmenu", onContextMenu)
    el.addEventListener("wheel", onWheel, { passive: false })
    document.addEventListener("pointerlockchange", onLockChange)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", onBlur)
      el.removeEventListener("pointerdown", onPointerDown)
      el.removeEventListener("pointermove", onPointerMove)
      el.removeEventListener("pointerup", onPointerUp)
      el.removeEventListener("contextmenu", onContextMenu)
      el.removeEventListener("wheel", onWheel)
      document.removeEventListener("pointerlockchange", onLockChange)
      if (locked()) document.exitPointerLock()
    }
  }, [camera, gl, keybinds])

  // Field of view: constant vertical FOV (see editorVerticalFov), independent of viewport size.
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    camera.fov = editorVerticalFov(cameraSettings, cameraPresets)
    camera.updateProjectionMatrix()
  }, [camera, cameraSettings, cameraPresets])

  // Focus selection
  useEffect(() => {
    if (focusRequest === 0) return
    const box = new THREE.Box3()
    for (const id of useEditor.getState().selectedIds) {
      const object = sceneRegistry.objects.get(id)
      if (object !== undefined) box.expandByObject(object)
    }
    if (box.isEmpty()) return
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const forward = camera.getWorldDirection(new THREE.Vector3())
    target.current.copy(sphere.center)
    camera.position.copy(sphere.center).addScaledVector(forward, -Math.max(sphere.radius * 2.5, 300))
  }, [focusRequest, camera])

  // Frame the whole map on load and on request. Uses item translations so it works before meshes load.
  useEffect(() => {
    const frameAll = () => {
      const { items } = useEditor.getState().doc.map
      const box = new THREE.Box3()
      for (const item of items) {
        const p = ueToThreeVector(item.itemTransform.translation)
        box.expandByPoint(new THREE.Vector3(p.x, p.y, p.z))
      }
      if (box.isEmpty()) {
        const floor = useEditor.getState().floorHeight
        box.set(new THREE.Vector3(-500, floor, -500), new THREE.Vector3(500, floor, 500))
      }
      const sphere = box.getBoundingSphere(new THREE.Sphere())
      const radius = Math.max(sphere.radius, 1000)
      target.current.copy(sphere.center)
      camera.position.copy(sphere.center).add(new THREE.Vector3(-1, 0.8, 1).normalize().multiplyScalar(radius * 1.6))
      camera.lookAt(sphere.center)
    }
    frameAll()
    return useEditor.subscribe((s, prev) => {
      if (s.frameAllRequest !== prev.frameAllRequest) frameAll()
    })
  }, [camera])

  useFrame((_, delta) => {
    const keys = pressed.current
    const now = performance.now()
    // Non-movement held keys (arrow look, fast) that are also tool shortcuts only count while
    // looking; movement keys follow the "movement keys need look" setting (see flyKeys).
    const looking = drag.current !== null
    const held = (bindings: Bindings) =>
      bindings.some((binding) => keys.holds(binding, now) && (looking || !isOneShotChord(keybinds, binding)))
    const dt = Math.min(delta, 0.1)

    // Arrow-key look (the game's "look right/left/up/down").
    const yaw = (held(keybinds.lookLeft) ? 1 : 0) - (held(keybinds.lookRight) ? 1 : 0)
    const pitch = (held(keybinds.lookUp) ? 1 : 0) - (held(keybinds.lookDown) ? 1 : 0)
    if ((yaw !== 0 || pitch !== 0) && drag.current === null) {
      const eul = euler.current.setFromQuaternion(camera.quaternion, "YXZ")
      const rate = KEY_LOOK_SPEED * cameraSettings.lookSensitivity * dt
      eul.y += yaw * rate
      eul.x = THREE.MathUtils.clamp(eul.x + pitch * rate, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001)
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
    const chordModifier = keys.has("ControlLeft") || keys.has("ControlRight") || keys.has("MetaLeft") ||
      keys.has("MetaRight") ||
      keys.has("AltLeft") || keys.has("AltRight")
    if (chordModifier && move.y === 0) return
    const { cameraSpeed } = useEditor.getState()
    const speed = cameraSettings.flySpeed * cameraSpeed * (held(keybinds.fastMove) ? FAST_MULTIPLIER : 1) * dt
    const horizontal = new THREE.Vector3(move.x, 0, move.z).applyQuaternion(camera.quaternion)
    const step = horizontal.add(new THREE.Vector3(0, move.y, 0)).normalize().multiplyScalar(speed)
    camera.position.add(step)
    target.current.add(step)
  })

  return null
}
