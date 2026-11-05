import { useEffect, useMemo } from "react"
import * as THREE from "three"
import { threeToUeVector, type Vec3 } from "../domain/coords"
import { axisOf, gridLevels, MAX_GRID_LEVELS, ORTHO_AXES } from "../domain/orthoView"
import { gridColorsOf } from "../domain/Settings"
import { AXIS_COLORS } from "./axisColors"
import { orthographicOnly } from "./paneCameras"
import { useBeforePaneDraw } from "./PaneRenderer"
import { useEditor } from "./store"
import { useDarkTheme } from "./theme"

/** Lines stay readable over the map's pieces without hiding them. */
const GRID_OPACITY = 0.4
/** Under the gizmo (1000) and over everything else. */
const RENDER_ORDER = 900

const vertexShader = /* glsl */ `
varying vec2 vScreen;
void main() {
  vScreen = position.xy;
  gl_Position = vec4( position.xy, 0.0, 1.0 ); // the whole pane, whatever the camera
}
`

const fragmentShader = /* glsl */ `
varying vec2 vScreen;
uniform vec2 uCentre; // cm along the view's right and up
uniform vec2 uHalf; // half the pane, in cm
uniform float uCmPerPixel; // per drawing-buffer pixel
uniform vec3 uLevels[${MAX_GRID_LEVELS}]; // size (cm; 0 ends the list), opacity, section
uniform vec3 uCell;
uniform vec3 uSection;
uniform vec3 uAxisAcross; // the axis running right across the screen
uniform vec3 uAxisUp; // the axis running up the screen
uniform float uOpacity;

/** Coverage of a line one pixel wide at distance d (pixels). */
float line(float d) {
  return 1.0 - smoothstep(0.0, 1.0, d);
}

void main() {
  vec2 p = uCentre + vScreen * uHalf;
  vec3 color = uCell;
  float alpha = 0.0;
  for (int i = 0; i < ${MAX_GRID_LEVELS}; i++) {
    vec3 level = uLevels[i];
    if (level.x <= 0.0) break;
    vec2 cell = abs(fract(p / level.x - 0.5) - 0.5) * level.x / uCmPerPixel;
    float a = line(min(cell.x, cell.y)) * level.y;
    if (a > 0.0) {
      color = mix(color, level.z > 0.5 ? uSection : uCell, a);
      alpha = max(alpha, a);
    }
  }
  alpha *= uOpacity;
  // The axes run through the world's origin: the line along X is where Y is 0.
  vec2 axis = abs(p) / uCmPerPixel;
  float across = line(axis.y * 0.5);
  float up = line(axis.x * 0.5);
  color = mix(color, uAxisAcross, across);
  color = mix(color, uAxisUp, up);
  alpha = max(alpha, max(across, up));
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4( color, alpha );
  #include <colorspace_fragment>
}
`

const gridUniforms = () => ({
  uCentre: { value: new THREE.Vector2() },
  uHalf: { value: new THREE.Vector2(1, 1) },
  uCmPerPixel: { value: 1 },
  uLevels: { value: Array.from({ length: MAX_GRID_LEVELS }, () => new THREE.Vector3()) },
  uCell: { value: new THREE.Color() },
  uSection: { value: new THREE.Color() },
  uAxisAcross: { value: new THREE.Color() },
  uAxisUp: { value: new THREE.Color() },
  uOpacity: { value: GRID_OPACITY }
})

/**
 * The world grid of an orthographic pane, in cm: a shader over the whole pane, so the same object serves every pane and
 * every zoom. Lines sit on multiples of their size from the world's origin, which is what the snapping grid does, and the
 * axes are in the game's colours. It goes with the floor grid in Show grid.
 */
export function OrthoGrid() {
  const appearance = useEditor((s) => s.settings.appearance)
  const dark = useDarkTheme(appearance.theme)
  const { cell, section } = gridColorsOf(appearance, dark)
  const uniforms = useMemo(() => gridUniforms(), [])
  const geometry = useMemo(() => new THREE.PlaneGeometry(2, 2), [])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false
      }),
    [uniforms]
  )
  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])
  useEffect(() => {
    uniforms.uCell.value.set(cell)
    uniforms.uSection.value.set(section)
  }, [uniforms, cell, section])

  useBeforePaneDraw((pane) => {
    const { view } = pane
    if (view === undefined) return
    const { right, up } = ORTHO_AXES[view]
    const { snapping } = useEditor.getState().settings
    const target = threeToUeVector(pane.target)
    const along = (axis: Vec3) => target.x * axis.x + target.y * axis.y + target.z * axis.z
    const cmPerPixel = pane.cmPerPixel / window.devicePixelRatio
    const levels = gridLevels(cmPerPixel, snapping.enabled ? snapping.gridSize : undefined)
    uniforms.uCentre.value.set(along(right), along(up))
    uniforms.uHalf.value.set((pane.width / 2) * pane.cmPerPixel, (pane.height / 2) * pane.cmPerPixel)
    uniforms.uCmPerPixel.value = cmPerPixel
    uniforms.uLevels.value.forEach((slot, i) => {
      const level = levels[i]
      slot.set(level?.size ?? 0, level?.opacity ?? 0, level?.section === true ? 1 : 0)
    })
    uniforms.uAxisAcross.value.set(AXIS_COLORS[axisOf(right).axis])
    uniforms.uAxisUp.value.set(AXIS_COLORS[axisOf(up).axis])
    material.uniformsNeedUpdate = true
  })

  if (!appearance.gridVisible) return null
  return (
    <mesh
      layers={orthographicOnly}
      geometry={geometry}
      material={material}
      renderOrder={RENDER_ORDER}
      frustumCulled={false}
      raycast={() => {}}
    />
  )
}
