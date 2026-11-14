/**
 * The line language of what the editor draws over the scene (docs/design/ui-system.md § Scene colours): one set of
 * weights, and one dash, which means "hidden" wherever it is drawn: a selected piece behind another, a snap box's far
 * side. A group's box has a shorter dash of its own (groupBox.ts). Lines are three's fat lines (`LineSegments2` with a `LineMaterial`), so they have a width in pixels, round ends
 * and antialiased edges, and their dashes are measured on screen.
 *
 * A dash is counted in pixels along its own segment and fitted to it, so a segment starts and ends on a dash and two
 * edges meet at a corner on dashes, and the dashes stay put on the line as the camera moves. A curve drawn as many short
 * segments would then be all dash, so a segment shorter than two dashes on screen, or one that is told to, `flow`s:
 * counts along the screen axis it runs more along, which carries on from one segment to the next.
 */
import * as THREE from "three"
import { LineMaterial, type LineMaterialParameters } from "three/examples/jsm/lines/LineMaterial.js"

/** Line weights, in CSS pixels. */
export const LINE_WIDTH = {
  /** The selection's outline, the paint tool's target, a group's box. */
  outline: 2,
  /** What only would be acted on: the hover, a hidden part, a guide. */
  light: 1.5,
  /** A snap's whole box, about the faces of it that snapped. */
  hairline: 1
} as const

/** A dash's lengths on and off, in CSS pixels. */
export interface Dash {
  readonly on: number
  readonly off: number
}

/** The hidden dash, in CSS pixels. */
export const DASH: Dash = { on: 6, off: 4 }

/** Where three's line shader takes an edit; each must be in it once (`screenLines.test.ts`). */
export const LINE_SHADER_ANCHORS = {
  /** The segment's ends are in view space, as `start` and `end`. */
  ends: "vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );",
  /** This corner's place is `clip`, about to be set, with the ends at `ndcStart` and `ndcEnd`. */
  place: "gl_Position = clip;",
  fragment: "void main() {"
} as const

/** Code for a `LineMaterial`'s shader, at the anchors above. */
export interface LineShaderEdit {
  /** Before the vertex shader: attributes, varyings. */
  readonly vertexHeader?: string
  readonly afterEnds?: string
  readonly beforePlace?: string
  /** Replaces `gl_Position = clip;`. */
  readonly place?: string
  readonly fragmentHeader?: string
  /** First thing in the fragment's `main`. */
  readonly fragmentStart?: string
}

const replaceOnce = (source: string, anchor: string, by: string): string => {
  if (!source.includes(anchor)) throw new Error(`three's line shader has no "${anchor}"`)
  return source.replace(anchor, by)
}

/** Applies `edits` to a line shader. */
export const editLineShader =
  (edits: ReadonlyArray<LineShaderEdit>) => (shader: { vertexShader: string; fragmentShader: string }): void => {
    const all = (pick: (edit: LineShaderEdit) => string | undefined) => edits.map((e) => pick(e) ?? "").join("\n")
    const place = edits.findLast((e) => e.place !== undefined)?.place ?? LINE_SHADER_ANCHORS.place
    let vertex = `${all((e) => e.vertexHeader)}\n${shader.vertexShader}`
    vertex = replaceOnce(vertex, LINE_SHADER_ANCHORS.ends, `${LINE_SHADER_ANCHORS.ends}\n${all((e) => e.afterEnds)}`)
    vertex = replaceOnce(vertex, LINE_SHADER_ANCHORS.place, `${all((e) => e.beforePlace)}\n${place}`)
    shader.vertexShader = vertex
    shader.fragmentShader = replaceOnce(
      `${all((e) => e.fragmentHeader)}\n${shader.fragmentShader}`,
      LINE_SHADER_ANCHORS.fragment,
      `${LINE_SHADER_ANCHORS.fragment}\n${all((e) => e.fragmentStart)}`
    )
  }

const glsl = (n: number) => n.toFixed(2)

/**
 * A dash measured on screen, the hidden one unless `dash` says otherwise. `flow` is GLSL for a float, 1 where the
 * segment's dashes carry on from its neighbours'; none fits every segment's own.
 */
export const screenDashes = (flow?: string, dash: Dash = DASH): LineShaderEdit => ({
  vertexHeader: `varying vec2 vDashAlong;
varying float vDashRun;
varying vec3 vDashScreen;
varying vec2 vDashAxis;
varying float vDashFlow;`,
  beforePlace: `{
      vec2 screenRun = ( ndcEnd.xy - ndcStart.xy ) * resolution * 0.5;
      vDashRun = length( screenRun );
      // over w, then divided by it per fragment: interpolated straight across the screen, not in depth
      vDashAlong = vec2( ( position.y < 0.5 ? 0.0 : vDashRun ) * clip.w, clip.w );
      vDashScreen = vec3( clip.xy * resolution * 0.5, clip.w );
      vDashAxis = abs( screenRun );
      // a segment shorter than two dashes is part of a curve, whatever its kind: fitted, it would be all dash
      vDashFlow = max( ${flow ?? "0.0"}, 1.0 - step( ${glsl(2 * (dash.on + dash.off))}, vDashRun ) );
    }`,
  fragmentHeader: `varying vec2 vDashAlong;
varying float vDashRun;
varying vec3 vDashScreen;
varying vec2 vDashAxis;
varying float vDashFlow;`,
  fragmentStart: `{
      float dashPeriod = ${glsl(dash.on + dash.off)};
      float dashOn = ${glsl(dash.on)};
      float dashAt;
      if ( vDashFlow > 0.5 ) {
        vec2 screen = vDashScreen.xy / vDashScreen.z;
        dashAt = vDashAxis.x >= vDashAxis.y ? screen.x : screen.y;
      } else {
        // a whole number of dashes, so the segment starts and ends on one
        float count = max( 1.0, floor( ( vDashRun + ${glsl(dash.off)} ) / dashPeriod + 0.5 ) );
        dashPeriod = ( vDashRun + ${glsl(dash.off)} ) / count;
        dashOn = dashPeriod * ${glsl(dash.on / (dash.on + dash.off))};
        dashAt = vDashAlong.x / vDashAlong.y;
      }
      if ( mod( dashAt, dashPeriod ) > dashOn ) discard;
    }`
})

/**
 * A line material for the scene's overlays: `linewidth` in pixels, never tone mapped. `edits` change its shader, and
 * `key` names that shader for three's program cache, which can't tell two edits apart by themselves. Two-sided: a fat
 * line is a strip of triangles facing the camera, and under a mirror (the game's frame to the scene's is one) three
 * would cull it as a back face.
 */
export const lineMaterial = (
  parameters: LineMaterialParameters,
  edits: ReadonlyArray<LineShaderEdit> = [],
  key?: string
): LineMaterial => {
  const material = new LineMaterial({ toneMapped: false, side: THREE.DoubleSide, ...parameters })
  if (edits.length > 0) {
    material.onBeforeCompile = editLineShader(edits)
    const name = key ?? "scene-line"
    material.customProgramCacheKey = () => name
  }
  return material
}

/** Faint enough to read as behind, strong enough to keep its hue on any piece. */
export const HIDDEN_OPACITY = 0.8

/** A line drawn only where the scene stands in front of it, dashed: the hidden part of what `color` outlines. */
export const hiddenLineMaterial = (
  color: THREE.ColorRepresentation,
  linewidth: number = LINE_WIDTH.light,
  edits: ReadonlyArray<LineShaderEdit> = [screenDashes()],
  key = "scene-line-hidden"
): LineMaterial =>
  lineMaterial(
    {
      color,
      linewidth,
      transparent: true,
      opacity: HIDDEN_OPACITY,
      depthWrite: false,
      depthFunc: THREE.GreaterDepth
    },
    edits,
    key
  )
