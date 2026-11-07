import { useEffect } from "react"
import * as THREE from "three"
import { threeToUeVector } from "../domain/coords"
import { axisOf, dot, gridLevels, MAX_GRID_LEVELS, ORTHO_AXES } from "../domain/orthoView"
import { gridColorsOf } from "../domain/Settings"
import { gridInView } from "../domain/snapGrid"
import { sceneAxisColors } from "./axisColors"
import { orthographicOnly } from "./paneCameras"
import { useBeforePaneDraw } from "./PaneRenderer"
import { snapConfigOf, useEditor } from "./store"
import { useDarkTheme } from "./theme"

/** Lines stay readable over the map's pieces without hiding them. */
const GRID_OPACITY = 0.4
/** Under the gizmo (1000) and over everything else. */
const RENDER_ORDER = 900
/** The depth, -1 to 1, that puts the grid behind what a pane draws: just this side of its far plane. */
const BEHIND_THE_MAP = 0.9999

const vertexShader = /* glsl */ `
varying vec2 vScreen;
uniform float uDepth;
void main() {
  vScreen = position.xy;
  gl_Position = vec4( position.xy, uDepth, 1.0 ); // the whole pane, whatever the camera
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
uniform vec2 uGridOrigin; // where the grid counts from, in the same cm
uniform vec2 uGridAcross; // turns a point from there into steps of the grid's lines across the view...
uniform vec2 uGridAlong; // ...and of those along it
uniform vec3 uAxisAcross; // the axis running right across the screen
uniform vec3 uAxisUp; // the axis running up the screen
uniform float uOpacity;

/** Coverage of a line one pixel wide at distance d (pixels). */
float line(float d) {
  return 1.0 - smoothstep(0.0, 1.0, d);
}

void main() {
  vec2 p = uCentre + vScreen * uHalf;
  vec2 q = p - uGridOrigin;
  vec2 g = vec2(dot(q, uGridAcross), dot(q, uGridAlong));
  vec3 color = uCell;
  float alpha = 0.0;
  for (int i = 0; i < ${MAX_GRID_LEVELS}; i++) {
    vec3 level = uLevels[i];
    if (level.x <= 0.0) break;
    vec2 cell = abs(fract(g / level.x - 0.5) - 0.5) * level.x / uCmPerPixel;
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

const uniforms = {
  uDepth: { value: 0 },
  uCentre: { value: new THREE.Vector2() },
  uHalf: { value: new THREE.Vector2(1, 1) },
  uCmPerPixel: { value: 1 },
  uLevels: { value: Array.from({ length: MAX_GRID_LEVELS }, () => new THREE.Vector3()) },
  uCell: { value: new THREE.Color() },
  uSection: { value: new THREE.Color() },
  uGridOrigin: { value: new THREE.Vector2() },
  uGridAcross: { value: new THREE.Vector2(1, 0) },
  uGridAlong: { value: new THREE.Vector2(0, 1) },
  uAxisAcross: { value: new THREE.Color() },
  uAxisUp: { value: new THREE.Color() },
  uOpacity: { value: GRID_OPACITY }
}

/** One for the editor's lifetime: every pane draws it, and a shader over the pane needs no camera of its own. */
const geometry = new THREE.PlaneGeometry(2, 2)
const material = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  toneMapped: false
})

/** The world grid of an orthographic pane (docs/DESKTOP.md § View panes): one shader for every pane and every zoom. */
export function OrthoGrid() {
  const appearance = useEditor((s) => s.settings.appearance)
  const dark = useDarkTheme(appearance.theme)
  const { cell, section } = gridColorsOf(appearance, dark)
  useEffect(() => {
    uniforms.uCell.value.set(cell)
    uniforms.uSection.value.set(section)
  }, [cell, section])

  useBeforePaneDraw((pane) => {
    const { view } = pane
    if (view === undefined) return
    // Square to the view, the lines belong over the pieces. On the way there the pieces are still turning under them.
    material.depthTest = pane.easing
    uniforms.uDepth.value = pane.easing ? BEHIND_THE_MAP : 0
    const { right, up } = ORTHO_AXES[view]
    const snapping = snapConfigOf(useEditor.getState())
    const target = threeToUeVector(pane.target)
    const cmPerPixel = pane.cmPerPixel / window.devicePixelRatio
    const levels = gridLevels(
      cmPerPixel,
      snapping.enabled && snapping.targets.grid.enabled ? snapping.gridSize : undefined
    )
    uniforms.uCentre.value.set(dot(target, right), dot(target, up))
    const grid = gridInView(snapping, right, up)
    uniforms.uGridOrigin.value.set(grid.origin.x, grid.origin.y)
    uniforms.uGridAcross.value.set(grid.across.x, grid.across.y)
    uniforms.uGridAlong.value.set(grid.along.x, grid.along.y)
    uniforms.uHalf.value.set((pane.width / 2) * pane.cmPerPixel, (pane.height / 2) * pane.cmPerPixel)
    uniforms.uCmPerPixel.value = cmPerPixel
    uniforms.uLevels.value.forEach((uniform, i) => {
      const level = levels[i]
      uniform.set(level?.size ?? 0, level?.opacity ?? 0, level?.section === true ? 1 : 0)
    })
    const axisColors = sceneAxisColors(dark)
    uniforms.uAxisAcross.value.set(axisColors[axisOf(right).axis])
    uniforms.uAxisUp.value.set(axisColors[axisOf(up).axis])
    material.uniformsNeedUpdate = true
  })

  return (
    <mesh
      visible={appearance.gridVisible}
      layers={orthographicOnly}
      geometry={geometry}
      material={material}
      renderOrder={RENDER_ORDER}
      frustumCulled={false}
      raycast={() => {}}
    />
  )
}
