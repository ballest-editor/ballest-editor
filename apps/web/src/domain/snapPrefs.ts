/**
 * How snapping behaves for you, whatever the map (docs/SNAPPING.md § Settings): Settings › Editor › Snapping, kept in the
 * editor's settings and never in a sidecar. The map's own snapping is `SnapConfig`. No renderer here.
 */
import { Schema } from "effect"

/** When a press on the selection's body drags it: to join ends (with Connectors on and ends to join), always, or never. */
export const BODY_DRAGS = ["ends", "always", "never"] as const

export const BODY_DRAG_NAMES: Readonly<Record<(typeof BODY_DRAGS)[number], string>> = {
  ends: "To join",
  always: "Always",
  never: "Never"
}

export const SnapPrefs = Schema.Struct({
  bodyDrag: Schema.Literals(BODY_DRAGS),
  /** When open ends are ringed (docs/SNAPPING.md § Connectors). */
  showOpenEnds: Schema.Literals(["never", "hover", "always"]),
  /** Whether ends of different profiles join: never, with a chip saying so, or silently. */
  profiles: Schema.Literals(["strict", "warn", "any"]),
  /** Offers the mirrored twin when it would fit and the piece itself wouldn't. */
  flipToFit: Schema.Boolean,
  /** Whether Mesh offers what something hides from the pane's camera. */
  occlusion: Schema.Literals(["front", "through"]),
  /** How many acquired points Tracking keeps. */
  trackingKeep: Schema.Int.check(Schema.isGreaterThan(0)),
  /** How long a hover takes to acquire, in ms. */
  trackingHoverMs: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  trackingAcquire: Schema.Literals(["auto", "shift"])
})
export type SnapPrefs = typeof SnapPrefs.Type

export const defaultSnapPrefs: SnapPrefs = {
  bodyDrag: "ends",
  showOpenEnds: "hover",
  profiles: "warn",
  flipToFit: true,
  occlusion: "front",
  trackingKeep: 6,
  trackingHoverMs: 400,
  trackingAcquire: "auto"
}

/** Where each of these lived in a map's snap settings before they moved here: a path into a stored `SnapConfig`. */
export const SNAP_PREFS_BEFORE: Readonly<Record<keyof SnapPrefs, ReadonlyArray<string>>> = {
  bodyDrag: ["bodyDrag"],
  showOpenEnds: ["targets", "connectors", "showOpenEnds"],
  profiles: ["targets", "connectors", "profiles"],
  flipToFit: ["targets", "connectors", "flipToFit"],
  occlusion: ["targets", "mesh", "occlusion"],
  trackingKeep: ["targets", "tracking", "keep"],
  trackingHoverMs: ["targets", "tracking", "hoverMs"],
  trackingAcquire: ["targets", "tracking", "acquire"]
}
