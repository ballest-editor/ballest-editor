import { useFrame, useThree } from "@react-three/fiber"
import { useEffect, useRef } from "react"
import * as THREE from "three"
import { threeToUeVector, ueToThreeVector } from "../domain/coords"
import { type Bindings, chordOf, HeldKeys, isBound, isBoundChord, isOneShotChord, mouseChordOf, wheelChordOf } from "../domain/Keybinds"
import { fovOf, verticalFov } from "../domain/Settings"
import { commands } from "./commands"
import { sceneRegistry } from "./sceneRegistry"
import { useEditor } from "./store"

const FAST_MULTIPLIER = 4
const LOOK_SENSITIVITY = 0.0025 // radians per pixel at sensitivity 1
const KEY_LOOK_SPEED = 1.6 // radians per second for the arrow-key look actions
const PLACE_DISTANCE = 1500
const MAX_GROUND_HIT = 20000

export const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))

/** Keyboard events that belong to a text field or an open dialog never drive the editor. */
export const isEditorKeyEvent = (e: KeyboardEvent): boolean =>
  !isTypingTarget(e.target) &&
  !commands.dialogOpen() &&
  !(e.target instanceof Element && e.target.closest("[role=dialog]") !== null)

type DragMode = "look" | "orbit" | "pan"

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
  const size = useThree((s) => s.size)
  const focusRequest = useEditor((s) => s.focusRequest)
  const frameAllRequest = useEditor((s) => s.frameAllRequest)

  const pressed = useRef(new HeldKeys())
  const drag = useRef<DragMode | null>(null)
  const target = useRef(new THREE.Vector3())
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"))

  // Placement point: ground-plane hit at screen centre, else a fixed distance ahead.
  useEffect(() => {
    sceneRegistry.camera = camera
    const raycaster = new THREE.Raycaster()
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    sceneRegistry.placementPoint = () => {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
      const hit = raycaster.ray.intersectPlane(ground, new THREE.Vector3())
      const point = hit !== null && hit.distanceTo(camera.position) < MAX_GROUND_HIT
        ? hit
        : camera.position.clone().addScaledVector(raycaster.ray.direction, PLACE_DISTANCE)
      const ue = threeToUeVector({ x: point.x, y: point.y, z: point.z })
      return { x: Math.round(ue.x), y: Math.round(ue.y), z: Math.round(ue.z) }
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

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditorKeyEvent(e)) pressed.current.press(e.code, performance.now(), isBoundChord(keybinds, chordOf(e)))
    }
    const onKeyUp = (e: KeyboardEvent) => pressed.current.release(e.code)
    const onBlur = () => pressed.current.clear()

    const onPointerDown = (e: PointerEvent) => {
      if (sceneRegistry.gizmoActive()) return
      const chord = mouseChordOf(e)
      const mode = dragModes.find(([bindings]) => bindings.includes(chord))?.[1]
      if (mode === undefined) return
      drag.current = mode
      if (mode === "orbit") {
        // keep the pivot if it's in front of us, otherwise orbit around a point ahead
        const forward = camera.getWorldDirection(new THREE.Vector3())
        if (target.current.clone().sub(camera.position).dot(forward) <= 0) {
          target.current.copy(camera.position).addScaledVector(forward, PLACE_DISTANCE)
        }
      }
      el.setPointerCapture(e.pointerId)
      euler.current.setFromQuaternion(camera.quaternion, "YXZ")
      e.preventDefault()
    }
    const onPointerMove = (e: PointerEvent) => {
      if (drag.current === null) return
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
      eul.x = THREE.MathUtils.clamp(eul.x - e.movementY * k * (invertLookY ? -1 : 1), -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001)
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
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }
    const onContextMenu = (e: Event) => e.preventDefault()
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const chord = wheelChordOf(e)
      const state = useEditor.getState()
      if (isBound(keybinds, "speedFaster", chord)) return state.changeSpeed(1)
      if (isBound(keybinds, "speedSlower", chord)) return state.changeSpeed(-1)
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
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", onBlur)
      el.removeEventListener("pointerdown", onPointerDown)
      el.removeEventListener("pointermove", onPointerMove)
      el.removeEventListener("pointerup", onPointerUp)
      el.removeEventListener("contextmenu", onContextMenu)
      el.removeEventListener("wheel", onWheel)
    }
  }, [camera, gl, keybinds])

  // Field of view: the game's presets are horizontal; three.js wants vertical for this aspect.
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    camera.fov = verticalFov(fovOf(useEditor.getState().settings, cameraPresets), size.width / Math.max(size.height, 1))
    camera.updateProjectionMatrix()
  }, [camera, size, cameraSettings.fovPreset, cameraSettings.customFov, cameraPresets])

  // Focus selection
  useEffect(() => {
    if (focusRequest === 0) return
    const { selectedId } = useEditor.getState()
    const object = selectedId === null ? undefined : sceneRegistry.objects.get(selectedId)
    if (object === undefined) return
    const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere())
    const forward = camera.getWorldDirection(new THREE.Vector3())
    target.current.copy(sphere.center)
    camera.position.copy(sphere.center).addScaledVector(forward, -Math.max(sphere.radius * 2.5, 300))
  }, [focusRequest, camera])

  // Frame the whole map (on load). Uses item translations so it works before meshes load.
  useEffect(() => {
    const { items } = useEditor.getState().doc.map
    const box = new THREE.Box3()
    for (const item of items) {
      const p = ueToThreeVector(item.itemTransform.translation)
      box.expandByPoint(new THREE.Vector3(p.x, p.y, p.z))
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-500, 0, -500), new THREE.Vector3(500, 0, 500))
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const radius = Math.max(sphere.radius, 1000)
    target.current.copy(sphere.center)
    camera.position.copy(sphere.center).add(new THREE.Vector3(-1, 0.8, 1).normalize().multiplyScalar(radius * 1.6))
    camera.lookAt(sphere.center)
  }, [frameAllRequest, camera])

  useFrame((_, delta) => {
    const keys = pressed.current
    const now = performance.now()
    // A fly key that is also a tool shortcut (W = forward and move mode, as in the game's
    // editor) only flies while the look button is held, UE-style; the rest fly any time.
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

    const move = new THREE.Vector3(
      (held(keybinds.moveRight) ? 1 : 0) - (held(keybinds.moveLeft) ? 1 : 0),
      (held(keybinds.moveUp) ? 1 : 0) - (held(keybinds.moveDown) ? 1 : 0),
      (held(keybinds.moveBack) ? 1 : 0) - (held(keybinds.moveForward) ? 1 : 0)
    )
    if (move.lengthSq() === 0) return
    // Keys held together with Ctrl/Alt are chords (Ctrl+S...), not movement.
    const chordModifier = keys.has("ControlLeft") || keys.has("ControlRight") || keys.has("MetaLeft") || keys.has("MetaRight") ||
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
