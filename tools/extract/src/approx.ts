// The per-material half of `materials build`: from a material's effective parameters and the trace of its
// compiled shader (MaterialShaders) to `approx`, what the renderer draws. Pure functions in four steps, each
// testable with a fake MaterialShaders: the name picks (parameters by name, for what the shader evaluation
// does not give), the translucency (which face an effect shows on), the layers (the texture reads by role)
// and the output.
import type { Leaf } from "./dxil.ts"
import { nameOf } from "./json.ts"
import { materialParams, type Merged, type Rgba } from "./params.ts"
import type { MaterialShaders, MaterialSurface } from "./shaders.ts"

export type Projection = "uv" | "object" | "world"
export type Role = "color" | "normal" | "orm" | "variation" | "opacity" | "mask"

/** The surface shaders.json evaluated for the material's own parameters. */
export type Surface = MaterialSurface

export interface Read {
  readonly texture: string
  readonly role: Role
  readonly channels: string
  /** uv: the mesh UV0; object: object-aligned position (rotates and, see instanceScale, scales with the piece); world. */
  readonly projection: Projection
  /** Repeats per UV unit (uv) or per centimetre (object / world), for u and v. */
  readonly scale: [number, number]
  /** 1: u, v also multiply by the instance's x, y scale; -1: divide; 0: no. */
  readonly instanceScale: number
  /** Normal maps: layer strength (1 = full), from the unpack constant. */
  readonly strength: number
  /** Constant-buffer values on the coordinate path the preshader did not resolve to a plain parameter. */
  readonly unresolved: ReadonlyArray<string>
  /** Colour reads: what the read adds to the base colour going 0 -> 1 (from the evaluated surface); null = unknown. */
  readonly gain: readonly [number, number, number] | null
  /** The read's mean colour the surface was evaluated at (so colour = base + gain * (read - mean)). */
  readonly mean: readonly [number, number, number] | null
  /** Translucent passes: what the read adds to the alpha going 0 -> 1. */
  readonly alphaGain: number
  /** What the read's alpha channel alone adds to the base colour; null = nothing (a layer only applies rgb). */
  readonly fromAlpha: readonly [number, number, number] | null
}

// ------------------------------------------------------------------ texture reads, from the trace
interface Source {
  readonly projection: Projection
  readonly factor: number
  readonly depth: number
}
// The deeper of two equal-factor paths decides: a position that went local -> world -> object is object-aligned
// even though the plain local -> world path is in the sum too.
const better = (a: Source | undefined, b: Source): boolean =>
  a === undefined || b.factor > a.factor || (b.factor === a.factor && b.depth > a.depth)

/** Where a coordinate leaf comes from: the mesh UVs, or a projection of the object / world position. */
export const sourceOf = (sh: MaterialShaders, leaf: Leaf): Source | undefined => {
  if (leaf.kind !== "input") return undefined
  // SV_Position reconstructs the world position; one transform on top of it is the object's inverse.
  if (leaf.source === "SV_Position") {
    return {
      projection: leaf.sceneDepth >= 1 ? "object" : "world",
      factor: Math.abs(leaf.factor),
      depth: leaf.sceneDepth
    }
  }
  if (!/^TEXCOORD\d+$/.test(leaf.source)) return undefined
  // An interpolant: what the vertex shader put in it. ATTRIBUTE0 is the local position: one transform makes
  // it world, two bring it back object-aligned (scaled); none is local.
  let best: Source | undefined
  for (const vl of sh.interpolants[`${leaf.source}.${leaf.component}`] ?? []) {
    const f = Math.abs(leaf.factor * vl.factor)
    const candidate: Source | undefined = vl.kind === "buffer"
      ? { projection: "uv", factor: f, depth: 0 }
      : vl.kind === "input" && vl.source === "ATTRIBUTE0"
      ? { projection: vl.sceneDepth === 1 ? "world" : "object", factor: f, depth: vl.sceneDepth }
      : undefined
    if (candidate && better(best, candidate)) best = candidate
  }
  return best
}

/** A constant-buffer ref on a traced path (`cb3[2].w`) -> its value for this material. */
const paramsOf = (sh: MaterialShaders, merged: Merged): (ref: string) => number | undefined =>
  sh.materialBuffer === null ? () => undefined : materialParams(sh.materialBuffer, sh, merged)

/** What the dump knows about a texture that decides a read's role. */
export interface TextureInfo {
  readonly compression?: string | undefined
  readonly sRGB?: boolean | undefined
}

/**
 * The shader's texture reads with their coordinates resolved for this material: projection and scale
 * (the strongest path per axis), the instance scale, and a role from the texture's compression settings.
 * `index` is the shader read index of each entry, for the evaluated gains and the mottle.
 */
export const readsOf = (
  sh: MaterialShaders,
  merged: Merged,
  textureOf: (slot: number) => string | null,
  textureInfo: (texture: string) => TextureInfo,
  translucent: boolean
): { reads: Array<Read>; index: Array<number> } => {
  const out: Array<Read> = []
  /** shader read index of each entry of `out` */
  const index: Array<number> = []
  const paramOf = paramsOf(sh, merged)
  for (const [ri, r] of sh.reads.entries()) {
    const tex = r.texture >= 0 ? textureOf(r.texture) : null
    if (tex === null) continue
    let projection: Projection | undefined
    let instanceScale = 0
    const unresolved = new Set<string>()
    const scale = r.coords.slice(0, 2).map((c) => {
      let best = 0
      for (const leaf of c.leaves) {
        const src = sourceOf(sh, leaf)
        if (src === undefined) continue
        let f = src.factor
        for (const p of leaf.params) {
          const v = paramOf(p)
          if (v === undefined) {
            if (sh.materialBuffer !== null && p.startsWith(sh.materialBuffer)) unresolved.add(p)
          } else f *= Math.abs(v)
        }
        if (f > best || (f === best && projection === undefined)) {
          best = f
          projection = src.projection
        }
        if (leaf.sceneScale !== 0) instanceScale = leaf.sceneScale
      }
      return best
    })
    if (projection === undefined) continue
    const info = textureInfo(tex)
    const compression = info.compression ?? ""
    const name = nameOf(tex)
    const role: Role = compression === "TC_Normalmap"
      ? "normal"
      : /MacroVariation/i.test(name)
      ? "variation"
      : compression === "TC_Masks"
      ? "orm"
      : translucent && r.channels.length === 1
      ? "opacity"
      : r.channels.length === 1 && info.sRGB === false
      ? "mask"
      : "color"
    const u = scale[0] ?? 0, v = scale[1] ?? u
    index.push(ri)
    // A projected read at more than one repeat per 5 cm is not a surface texture: the coordinate went
    // through a cell function (floor/frac) the trace does not follow (M_PlasticBase's hex-cell lookups).
    if (projection !== "uv" && Math.max(u, v) > 0.2) unresolved.add("scale")
    out.push({
      texture: tex,
      role,
      channels: r.channels,
      projection,
      scale: [u, v === 0 ? u : v],
      instanceScale,
      strength: role === "normal" && r.resultFactor !== null ? Math.abs(r.resultFactor) / 2 : 1,
      unresolved: [...unresolved].sort(),
      gain: null,
      mean: null,
      alphaGain: 0,
      fromAlpha: null
    })
  }
  return { reads: out, index }
}

export interface Variation {
  readonly texture: string
  readonly tilings: ReadonlyArray<[number, number]>
  readonly offsets: ReadonlyArray<number>
  readonly gain: number
}

/** The mottle, with its gain evaluated for this instance's parameters: `colour *= 1 + gain * product(read + offset)`. */
export const variationOf = (
  sh: MaterialShaders,
  merged: Merged,
  reads: ReadonlyArray<Read>,
  readIndex: ReadonlyArray<number>
): Variation | null => {
  const mo = sh.mottle
  if (mo === null) return null
  const layers = mo.reads.map((i) => readIndex.indexOf(i)).map((i) => reads[i])
  if (layers.some((l) => l === undefined)) return null
  const paramValue = mo.gain.param === undefined ? 1 : paramsOf(sh, merged)(mo.gain.param)
  if (paramValue === undefined) return null
  const gain = mo.gain.sign * mo.gain.constant * (paramValue + (mo.gain.paramAdd ?? 0))
  const first = layers[0]
  if (first === undefined) return null
  return {
    texture: first.texture,
    tilings: layers.map((l) => l?.scale ?? [1, 1]),
    offsets: mo.offsets,
    gain
  }
}

// ------------------------------------------------------------------ 1. name picks
/** A parameter picked by name: which one (null = none matched, a neutral default applies) and its value. */
export interface Picked<T> {
  readonly key: string | null
  readonly value: T | null
}

const pick = <T>(
  entries: Record<string, T | null>,
  patterns: ReadonlyArray<RegExp>,
  exclude = /$^/
): Picked<T> => {
  for (const re of patterns) {
    for (const [k, v] of Object.entries(entries)) {
      if (re.test(k) && !exclude.test(k) && v != null) return { key: k, value: v }
    }
  }
  return { key: null, value: null }
}

/** The PBR values picked from the parameters by name: what stands in where the shader is not evaluated. */
export interface Picks {
  readonly baseColor: Picked<Rgba>
  readonly metallic: Picked<number>
  readonly roughness: Picked<number>
  readonly opacity: Picked<number>
  readonly emissive: Picked<Rgba>
  readonly emissiveIntensity: Picked<number>
  /** The emissive colour times its intensity, when the colour is lit at all; else null. */
  readonly pickedEmissive: ReadonlyArray<number> | null
  /** The root's EmissiveColor pin is connected but BaseColor is not: black + emissive in UE. */
  readonly emissiveOnly: boolean
}

/** The graph's wiring is not in the cooked asset: the parameter names are the next best thing. */
export const picksOf = (merged: Merged, connectedOutputs: ReadonlyArray<string> | null): Picks => {
  const S = merged.scalars, V = merged.vectors
  const emissiveOnly = connectedOutputs !== null && connectedOutputs.includes("EmissiveColor") &&
    !connectedOutputs.includes("BaseColor")
  const baseColor = pick(V, [
    /^base ?colou?r$/i,
    /^(albedo|diffuse)( ?colou?r)?$/i,
    /^colou?r$/i,
    /^tint$/i,
    /base ?colou?r|albedo|diffuse/i,
    /colou?r ?glass|glass ?colou?r/i,
    /colou?r|tint/i
  ], /emiss|fresnel|edge|outline|light|grunge|highlight|angle|secondary|direction|noise|blend/i)
  const metallic = pick(
    S,
    [/^metal(lic)?$/i, /^metal(lic)?[ _]?(value|amount)?$/i],
    /mult|min|max|angle|mask/i
  )
  const roughness = pick(S, [
    /^roughness$/i,
    /^roughness[ _]?(value|amount)?$/i,
    /^roughness[ _]?(min|low)$/i,
    /rough/i
  ], /mult|max|high|contrast|offset|grunge|edge|angle|rain/i)
  const opacity = pick(S, [/^opacity$/i, /^opacity[ _]?(value|amount)?$/i, /opacity/i], /DT\d|detail|mask/i)
  // Not /light colou?r/ unanchored: it matched M_OutlineEdges' HighlightColor, an inactive highlight tint.
  const emissive = pick(V, [/emiss/i, /glow/i, /^light[ _]?colou?r$/i], /highlight/i)
  const emissiveIntensity = pick(S, [
    /emm?iss?ive[ _]?(intensity|strength|power|mult|brightness)/i,
    /light[ _]?emissive[ _]?intensity/i,
    /glow[ _]?(intensity|strength)/i,
    /^(intensity|brightness)$/i
  ])
  const em = emissive.value
  const pickedEmissive = em?.slice(0, 3).some((x) => x > 0)
    ? em.slice(0, 3).map((x) => x * (emissiveIntensity.value ?? 1))
    : null
  return { baseColor, metallic, roughness, opacity, emissive, emissiveIntensity, pickedEmissive, emissiveOnly }
}

// ------------------------------------------------------------------ 2. translucency
/**
 * A translucent effect shows on the faces where its alpha (additive: its glow) is largest: the vertical sides
 * of a beam whose caps are masked by 1 - |world normal z|. upFade is what is left of that on a face that looks
 * up; the mask is a shape, kept even when the evaluated alpha is too faint to use.
 */
export interface Translucency {
  readonly translucent: boolean
  readonly additive: boolean
  /** The pass refracts and has no glow of its own: its scene colour is what is behind it. */
  readonly refracts: boolean
  /** The evaluated alpha on the face that shows most; null without an evaluation. */
  readonly alphaShown: number | null
  /** 0..1: how much of the opacity (additive: the glow) is left on a face that looks up; null = all of it. */
  readonly upFade: number | null
  /** An additive pass's evaluated glow on the face that shows it; otherwise the emissive picked by name. */
  readonly emissiveColor: ReadonlyArray<number> | null
  /** emissiveColor is the evaluated glow, not the name pick. */
  readonly glowEvaluated: boolean
}

export const translucencyOf = (
  blendMode: string,
  evaluated: Surface | null,
  pickedEmissive: ReadonlyArray<number> | null,
  connectedOutputs: ReadonlyArray<string> | null = null
): Translucency => {
  const translucent = /Translucent|Additive|Modulate/.test(blendMode)
  const additive = blendMode.includes("Additive")
  const alphaUp = evaluated?.opacity ?? null
  const alphaSide = evaluated?.opacitySide ?? alphaUp
  const alphaShown = alphaUp === null || alphaSide === null ? null : Math.max(alphaUp, alphaSide)
  const glowUp = Math.max(...(evaluated?.emissive ?? [0]))
  const glowSide = Math.max(...(evaluated?.emissiveSide ?? [0]))
  const glowShown = Math.max(glowUp, glowSide)
  // A pass's unlit scene colour is its glow, evaluated on the face that shows it: all an additive pass adds, and
  // the emissive a translucent one draws over its lit base colour. A refracting pass (glass, water) draws the scene
  // behind it there, no glow: evaluated, that is mid-grey at most, where a real one (the checkpoint's panel) is HDR.
  const refracts = (connectedOutputs?.includes("Refraction") ?? false) && glowShown < 1
  const glow = translucent && !refracts && evaluated !== null && glowShown > 0 ? evaluated : null
  const emissiveColor = glow !== null ? glowSide > glowUp ? glow.emissiveSide : glow.emissive : pickedEmissive
  const upFade = additive && glowShown > 0
    ? Math.min(1, glowUp / glowShown)
    : alphaSide !== null && alphaSide > (alphaUp ?? 0)
    ? Math.min(1, (alphaUp ?? 0) / alphaSide)
    : null
  return { translucent, additive, refracts, alphaShown, upFade, emissiveColor, glowEvaluated: glow !== null }
}

// ------------------------------------------------------------------ 3. layers
/** The texture reads by role, with the evaluated gains folded in, and the primary read of each role. */
export interface Layers {
  readonly reads: ReadonlyArray<Read>
  readonly normalRead: Read | undefined
  readonly variationRead: Read | undefined
  readonly opacityRead: Read | undefined
  readonly ormRead: Read | undefined
  /** Reads the evaluated surface says add to the base colour (gain != 0), strongest first. */
  readonly colorLayers: ReadonlyArray<Read>
  readonly projection: Projection
  readonly variation: Variation | null
  /**
   * The base colour depends on a read the layers cannot place: one whose coordinates are not fully known (a
   * cell function, an unresolved parameter: the paddle's stripe goes through frac) or whose alpha channel
   * carries a mask (the spinning cylinder's stripes). The material's base program draws it instead.
   */
  readonly unplaced: boolean
}

/**
 * A read that moves the colour visibly (by a tenth of full scale): the paddle's stripe (1), the cylinder's (0.8).
 * Smaller detail the trace cannot place (DefaultMaterial's, the rough paints' faint grain) stays a flat colour.
 */
const visible = (rgb: ReadonlyArray<number> | null | undefined) => rgb?.some((x) => Math.abs(x) >= 0.1) ?? false

export const layersOf = (
  sh: MaterialShaders | undefined,
  merged: Merged,
  textureOf: (slot: number) => string | null,
  textureInfo: (texture: string) => TextureInfo,
  translucent: boolean
): Layers => {
  const evaluated = sh?.surface ?? null
  const traced: { reads: Array<Read>; index: Array<number> } = sh === undefined
    ? { reads: [], index: [] }
    : readsOf(sh, merged, textureOf, textureInfo, translucent)
  // A normal map's strength is what the shader does with it: the unpack constant says how it is decoded, but a
  // master can fade it by a parameter (M_ArenaColorBase, to nothing at ConcreteValue 0) or by another read (the air
  // vent's map shows only at the peak of its slats). An opaque evaluation measures that for a map on the mesh's UVs,
  // where no response means no map; a projected map's axes depend on the face, which the facing surface cannot show.
  const measured = evaluated?.metallic != null
  const reads = traced.reads.map((r, i) => {
    const g = evaluated?.gains[String(traced.index[i])]
    const strength = measured && r.role === "normal" && r.projection === "uv"
      ? Math.min(r.strength, Math.abs(g?.normal ?? 0))
      : r.strength
    return g === undefined
      ? { ...r, strength }
      : { ...r, strength, gain: g.gain, mean: g.mean, alphaGain: g.alpha, fromAlpha: g.fromAlpha ?? null }
  })
  const variation = sh === undefined ? null : variationOf(sh, merged, reads, traced.index)
  // Only reads whose coordinates are fully known can stand for a role.
  const byRole = (role: Role) => reads.filter((r) => r.role === role && r.unresolved.length === 0)
  // The main normal layer: decoded strongest, then the coarsest (the Env masters add a fine x12 layer at full strength).
  const decoded = (r: Read) => traced.reads[reads.indexOf(r)]?.strength ?? r.strength
  const normals = byRole("normal").sort((a, b) => decoded(b) - decoded(a) || a.scale[0] - b.scale[0])
  const primary = (role: Role) => byRole(role)[0]
  // Colour layers: reads the evaluated surface says add to the base colour (gain != 0). Without an
  // evaluation (translucent passes) no colour texture is applied: the parameters alone are safer.
  const colorLayers = reads
    .filter((r) =>
      r.role !== "normal" && r.gain !== null && r.unresolved.length === 0 && r.gain.some((x) => Math.abs(x) >= 1e-4)
    )
    .sort((a, b) => Math.max(...(b.gain ?? [0]).map(Math.abs)) - Math.max(...(a.gain ?? [0]).map(Math.abs)))
  const normalRead = normals[0]
  const variationRead = primary("variation")
  const opacityRead = primary("opacity")
  const ormRead = primary("orm")
  const projection: Projection = (normalRead ?? colorLayers[0] ?? variationRead ?? opacityRead)?.projection ?? "uv"
  // Reads the trace dropped (no coordinate source it could follow) that still move the colour.
  const untraced = Object.entries(evaluated?.gains ?? {}).some(([i, g]) =>
    !traced.index.includes(Number(i)) && (sh?.reads[Number(i)]?.texture ?? -1) >= 0 && visible(g.gain)
  )
  const unplaced = reads.some((r) => r.role !== "normal" && (r.unresolved.length > 0 || visible(r.fromAlpha))) ||
    untraced
  return { reads, normalRead, variationRead, opacityRead, ormRead, colorLayers, projection, variation, unplaced }
}

// ------------------------------------------------------------------ 4. output
export interface ApproxInput {
  readonly merged: Merged
  readonly evaluated: Surface | null
  readonly picks: Picks
  readonly translucency: Translucency
  readonly layers: Layers
  /** A texture object path -> its PNG under assets, or null when it was not decoded. */
  readonly texPath: (texture: string | null) => string | null
  /** A material texture slot -> the texture it holds for this instance. */
  readonly textureOf: (slot: number) => string | null
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const MIN_NORMAL_STRENGTH = 0.02
/** A program that compares a UV directly: a band of colour with no texture behind it. */
const UV_BAND = /\(uv\.[xy] [<>]/

/** `approx`: what the renderer draws for the material. */
export const approxOf = (
  { evaluated, layers, merged, picks, texPath, textureOf, translucency }: ApproxInput
) => {
  const S = merged.scalars, V = merged.vectors
  const { additive, alphaShown, emissiveColor, refracts, translucent, upFade } = translucency
  const { colorLayers, normalRead, opacityRead, ormRead, projection, reads, unplaced, variation, variationRead } =
    layers
  const bc = picks.baseColor.value
  // M_OutlineEdges: a band of OutlineBase grey along the UV border, `Size` being the un-banded fraction.
  const outlineBase = V["OutlineBase"]
  const sizeX = S["Size X"], sizeY = S["Size Y"]
  const outline = outlineBase != null && sizeX != null && sizeY != null
    ? { inset: [(1 - sizeX) / 2, (1 - sizeY) / 2], color: outlineBase.slice(0, 3) }
    : null
  const tex = (r: Read | undefined) => (r === undefined ? null : texPath(r.texture))
  // The shader's own math as GLSL (alpha of a translucent pass, an additive glow, or an opaque base colour
  // whose reads the layers above could not place): what the renderer runs instead of the linearised look.
  const programs = Object.fromEntries(
    Object.entries(evaluated?.programs ?? {})
      // A base program only where the layers cannot place a read or the colour is drawn from the UVs with no
      // texture at all (the paddle's top stripe).
      .filter(([kind, p]) => kind !== "base" || unplaced || UV_BAND.test(p.code))
      .filter(([kind]) => kind !== "glow" || !refracts)
      .map(([kind, p]) => [kind, {
        code: p.code,
        textures: p.textures.map((t) => ({
          uniform: t.uniform,
          texture: texPath(textureOf(t.texture)) ?? `missing:${t.texture}`
        }))
      }])
  )
  // An additive pass is all glow, also when the glow only shows through its texture masks (zero at their means).
  const allGlow = additive && (emissiveColor !== null || programs["glow"] !== undefined)
  return {
    // The evaluated shader where there is one (opaque); else parameters picked by name. Emissive-only
    // masters (BaseColor pin unconnected) render black + emissive in UE.
    baseColor: evaluated !== null && !allGlow
      ? evaluated.baseColor.map(clamp01)
      : (picks.emissiveOnly && emissiveColor) || allGlow
      ? [0, 0, 0]
      : (bc ?? [0.8, 0.8, 0.8, 1]).slice(0, 3),
    metallic: evaluated?.metallic != null ? clamp01(evaluated.metallic) : picks.metallic.value ?? 0,
    roughness: evaluated?.roughness != null ? clamp01(evaluated.roughness) : picks.roughness.value ?? 0.6,
    evaluated: evaluated !== null,
    // An additive pass is all glow (its alpha is 0): drawn at full strength, faded by upFade. A translucent
    // pass whose alpha vanishes on every face (a view-angle effect) keeps the parameter's opacity.
    opacity: allGlow
      ? 1
      : alphaShown !== null && alphaShown >= 0.02
      ? clamp01(alphaShown)
      : picks.opacity.value ?? (translucent ? 0.5 : 1),
    // 0..1: how much of the opacity (additive: the glow) is left on a face that looks up; null = all of it.
    upFade,
    emissive: emissiveColor,
    baseColorTexture: null,
    // A map that barely moves the normal is not drawn at all.
    normalTexture: (normalRead?.strength ?? 0) >= MIN_NORMAL_STRENGTH ? tex(normalRead) : null,
    normalStrength: normalRead?.strength ?? 1,
    ormTexture: tex(ormRead),
    variationTexture: tex(variationRead),
    opacityTexture: tex(opacityRead),
    tiling: {
      baseColor: [1, 1],
      normal: normalRead?.scale ?? [1, 1],
      variation: variationRead?.scale ?? [1, 1],
      opacity: opacityRead?.scale ?? [1, 1]
    },
    projection,
    instanceScale: (normalRead ?? colorLayers[0])?.instanceScale ?? 0,
    // Translucent: texture reads the alpha depends on (alpha = opacity + sum alphaGain * (read - mean)). An
    // effect that multiplies sparse reads (ray streaks) swings far more where they all peak than any one
    // read's gain says: the strongest read carries the whole swing (alphaRange) if that is larger.
    opacityLayers: reads
      .filter((r) => r.role !== "normal" && r.unresolved.length === 0 && Math.abs(r.alphaGain) >= 1e-4)
      .sort((a, b) => Math.abs(b.alphaGain) - Math.abs(a.alphaGain))
      .map((r, i) => {
        // The channel the shader reads (a single-channel read; the first of a wider one), and its mean.
        const channel = "xyzw".indexOf(r.channels[0] ?? "x")
        return {
          texture: texPath(r.texture) ?? `missing:${r.texture}`,
          tiling: r.scale,
          projection: r.projection,
          instanceScale: r.instanceScale,
          channel: "rgba"[channel] ?? "r",
          gain: i === 0 && evaluated?.alphaRange && r.alphaGain > 0
            ? Math.max(r.alphaGain, evaluated.alphaRange[1] - evaluated.alphaRange[0])
            : r.alphaGain,
          mean: r.mean === null ? 0.5 : r.mean[channel] ?? 0.5
        }
      }),
    // Textures added to the base colour, each scaled by what the shader adds for it (colour = base + sum gain_i * read_i).
    // A base program computes the whole colour itself, layers and mottle included.
    colorLayers: (programs["base"] ? [] : colorLayers).map((r) => ({
      texture: texPath(r.texture) ?? `missing:${r.texture}`,
      tiling: r.scale,
      projection: r.projection,
      instanceScale: r.instanceScale,
      gain: r.gain,
      mean: r.mean
    })),
    // The mottle exactly as the shader applies it: colour *= 1 + gain * product_i(texture(tilings_i) + offsets_i).
    variation: variation === null || programs["base"]
      ? null
      : { ...variation, texture: texPath(variation.texture) ?? `missing:${variation.texture}` },
    outline,
    programs,
    // Which parameters the name-based picks used (translucent passes, emissive); null = neutral default.
    keys: {
      baseColor: evaluated === null ? picks.baseColor.key : null,
      metallic: evaluated?.metallic == null ? picks.metallic.key : null,
      roughness: evaluated?.roughness == null ? picks.roughness.key : null,
      opacity: alphaShown === null ? picks.opacity.key : null,
      emissive: translucency.glowEvaluated ? null : picks.emissive.key,
      emissiveIntensity: picks.emissiveIntensity.key
    }
  }
}
