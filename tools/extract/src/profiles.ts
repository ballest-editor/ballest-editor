// The cross-sections ends come in (docs/qa/connectors.md § Profiles): each family's caps as the meshes have them. Two
// ends fit when their profiles are the same, so a cap that differs in area, size or the height of its running surface
// is a profile of its own.
import type { CapMeasure } from "./caps.ts"

/** A cap a profile takes: what its measures must be, within `AREA_SHARE` and `SIZE_CM`. */
interface Signature {
  /** The piece it was read off. */
  readonly from: string
  readonly area?: number
  readonly width?: number
  readonly height?: number
  /** For a tall cap whose depth varies piece to piece: at least this tall. */
  readonly minHeight?: number
  readonly topWidth?: number
  /** For a tall cap: at least this share of the box around it is cap. A slab on a stem fills less of it than a wall. */
  readonly minFill?: number
  readonly maxFill?: number
  readonly radius?: number
  readonly innerRadius?: number
}

export interface Profile {
  readonly name: string
  /**
   * Where the end sits on its cap. `top`: the middle of the cap's top edge, for a profile that is ridden on (a track,
   * a bevel, a half tube), so running surfaces meet whatever the depth below. `centre`: the middle of the cap, for one
   * that is ridden through (a full tube, a pipe).
   */
  readonly anchor: "top" | "centre"
  /** Lopsided: the top leans to one side, so the end carries a hand. */
  readonly handed?: true
  readonly caps: ReadonlyArray<Signature>
}

export const PROFILES: ReadonlyArray<Profile> = [
  { name: "Track", anchor: "top", caps: [{ from: "BP_Track_Mid1", area: 50000, width: 500, height: 100 }] },
  {
    name: "Bevel_F",
    anchor: "top",
    caps: [
      { from: "Bevel_Full_Straight", area: 109079, width: 500, height: 235, topWidth: 370.22 },
      // The Cap's own end is 15 cm deeper, on the same running surface.
      { from: "BP_Bevel_Full_Cap", area: 116579, width: 500, height: 250, topWidth: 370.22 }
    ]
  },
  {
    name: "Bevel_H",
    anchor: "top",
    caps: [{ from: "Bevel_Half_Straight", area: 58289.5, width: 500, height: 125, topWidth: 370.22 }]
  },
  {
    name: "Bevel_C",
    anchor: "top",
    handed: true,
    caps: [{ from: "Bevel_Half_CornerStraight", area: 29144.75, width: 250, height: 125, topWidth: 185.11 }]
  },
  // The tall bevels go down to different depths: their caps share the top and the width. Branch and Wall are a Bevel_F
  // slab on a narrower stem; Sheer and Cap are a wall the full width down, under a Bevel_H top.
  {
    name: "Bevel_T",
    anchor: "top",
    caps: [{ from: "Bevel_Tall_Branch", width: 500, minHeight: 1000, topWidth: 370.22, maxFill: 0.9 }]
  },
  {
    name: "Bevel_T Sheer",
    anchor: "top",
    caps: [{ from: "Bevel_Tall_SheerStraight", width: 500, minHeight: 1000, topWidth: 370.22, minFill: 0.99 }]
  },
  {
    name: "Bevel_TC",
    anchor: "top",
    handed: true,
    caps: [{ from: "Bevel_Tall_CornerStraight", width: 250, minHeight: 1000, topWidth: 185.11 }]
  },
  {
    name: "Round",
    anchor: "top",
    caps: [{ from: "BP_Track_Round_Curve", area: 81012.36, width: 500, height: 198.25 }]
  },
  // Round Straight's section is 50 cm lower than the round curves'.
  {
    name: "Round Low",
    anchor: "top",
    caps: [{ from: "BP_Track_Round_Straight", area: 65726.69, width: 500, height: 149.57 }]
  },
  // A quarter pipe's wall is on one side of it.
  {
    name: "Pipe Q",
    anchor: "top",
    handed: true,
    caps: [{ from: "BP_Pipe_Quarter_Straight", area: 49967.11, width: 368.31, height: 368.31 }]
  },
  {
    name: "Pipe Q Small",
    anchor: "top",
    handed: true,
    caps: [{ from: "BP_Pipe_Quarter_Small", area: 42385, width: 390.6, height: 268.49 }]
  },
  {
    name: "Tube F",
    anchor: "centre",
    caps: [{ from: "BP_GlossyRed_Tube_Straight", radius: 150, innerRadius: 142.5 }]
  },
  // A half tube's top is its axis, where a full tube's centre is: the two line up though they don't fit.
  {
    name: "Tube H",
    anchor: "top",
    caps: [{ from: "BP_GlossyRed_Half_TubeLong_Straight", area: 3423.83, width: 300, height: 150 }]
  },
  {
    name: "Funnel",
    anchor: "centre",
    caps: [{ from: "BP_GlossyRed_Tube_Funnel", radius: 238.79, innerRadius: 226.85 }]
  },
  { name: "Pipe", anchor: "centre", caps: [{ from: "BP_Pipe_Tube1", radius: 50 }] },
  { name: "Tunnel", anchor: "centre", caps: [{ from: "MP_TunnelHalf", radius: 48, innerRadius: 46 }] },
  {
    name: "Rail",
    anchor: "centre",
    caps: [{ from: "Bevel_Rail", area: 8628.32, width: 140.63, height: 66.09 }]
  }
]

const AREA_SHARE = 0.001
const SIZE_CM = 0.5

const near = (measured: number, expected: number | undefined) =>
  expected === undefined || Math.abs(measured - expected) <= SIZE_CM

const fits = (cap: CapMeasure, signature: Signature): boolean => {
  const { shape } = cap
  const round = signature.radius !== undefined
  if (round) {
    if (shape.shape !== "circle" && shape.shape !== "annulus") return false
    const inner = shape.shape === "annulus" ? shape.innerRadius : undefined
    return near(shape.radius, signature.radius) &&
      (inner === undefined ? signature.innerRadius === undefined : near(inner, signature.innerRadius))
  }
  if (shape.shape === "circle" || shape.shape === "annulus") return false
  return (signature.area === undefined || Math.abs(cap.area - signature.area) <= signature.area * AREA_SHARE) &&
    near(cap.width, signature.width) && near(cap.height, signature.height) && near(cap.topWidth, signature.topWidth) &&
    (signature.minHeight === undefined || cap.height >= signature.minHeight) &&
    (signature.minFill === undefined || cap.area >= cap.width * cap.height * signature.minFill) &&
    (signature.maxFill === undefined || cap.area <= cap.width * cap.height * signature.maxFill)
}

/** The profile a cap, measured with its up, belongs to, if any. */
export const profileOf = (cap: CapMeasure): Profile | undefined =>
  PROFILES.find((profile) => profile.caps.some((signature) => fits(cap, signature)))
