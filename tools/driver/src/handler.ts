import { Context, Effect, Layer, Schema } from "effect"
import { Channel } from "./channel.ts"
import { Plugin } from "./plugin.ts"
import { type DriverError, fail } from "./slots.ts"

// The editor's handler (SKGMLEHandlerComponent, the editor pawn's component that owns the selection and the gizmo),
// reached through the test channel's `callx`, which reports out parameters and return values as hex. Measured on
// this build with `functions SKGMLEHandlerComponent` and `dumptypes` (docs/DRIVER.md § Pivots and the gizmo).

/** ESKGMLEEditorPivot, in enum order: the inspector's pivot buttons (docs/FORMAT.md § Pivots) and WorldOrigin. */
export const PIVOT_CHOICES = [
  "Default",
  "Center",
  "Bottom",
  "Top",
  "Left",
  "Right",
  "Back",
  "Front",
  "WorldOrigin"
] as const
export type PivotChoice = (typeof PIVOT_CHOICES)[number]

export type Vec3 = readonly [number, number, number]

/** An FTransform's rotation as a quaternion (x, y, z, w) and location in cm. */
export interface Transform {
  readonly rotation: readonly [number, number, number, number]
  readonly location: Vec3
}

/** The plugin's answer to `pieces` and `selection`. */
const PiecesReply = Schema.Struct({
  ok: Schema.Boolean,
  pieces: Schema.Array(Schema.Struct({ id: Schema.Finite, class: Schema.String }))
})
export const decodePieces = (reply: unknown) =>
  Schema.decodeUnknownEffect(PiecesReply)(reply).pipe(
    Effect.mapError(() => fail(`the plugin's reply isn't a list of pieces: ${JSON.stringify(reply)}`))
  )

const HANDLER = "SKGMLEHandlerComponent"
/** The live handler (the editor pawn's, in the level), not the blueprints' archetypes. */
const LIVE = "PersistentLevel"

const doubleAt = (bytes: Buffer, index: number) => bytes.readDoubleLE(index * 8)

/**
 * An FTransform from the bytes callx reports: four doubles of quaternion, then three of translation. The host dumps
 * the first 64 bytes of a value, so the scale (after the translation's padding) never arrives.
 */
export const decodeTransform = (hex: string): Transform | null => {
  if (!/^[0-9a-fA-F]{112,}$/.test(hex)) return null
  const b = Buffer.from(hex.slice(0, 112), "hex")
  return {
    rotation: [doubleAt(b, 0), doubleAt(b, 1), doubleAt(b, 2), doubleAt(b, 3)],
    location: [doubleAt(b, 4), doubleAt(b, 5), doubleAt(b, 6)]
  }
}

/** The hex of one reported value (`Name=hex`) in a callx reply that ran (` ok`), or null. */
export const callxValue = (replies: ReadonlyArray<string>, name: string): string | null => {
  const line = replies.find((r) => r.startsWith("callx ") && r.includes(" ok"))
  if (line === undefined) return null
  return new RegExp(` ${name}=([0-9a-fA-F]+)`).exec(line)?.[1] ?? null
}

/** The choice named by one byte of ESKGMLEEditorPivot, as callx reports it. */
export const pivotFromByte = (hex: string): PivotChoice | null => PIVOT_CHOICES[Number.parseInt(hex, 16)] ?? null

export interface PivotState {
  readonly choice: PivotChoice
  /** Where the gizmo sits and how it is turned: the selection's transform. */
  readonly gizmo: Transform
}

export interface Measurement {
  readonly id: number
  readonly class: string
  /** The piece's own pivot choice (left as it was). */
  readonly pivot: PivotChoice
  /** The gizmo's transform with the piece's own pivot: where the editor puts it when the piece is selected. */
  readonly gizmo: Transform
  /** The piece's origin (the gizmo with the Default pivot). */
  readonly origin: Vec3
  /** The centre of its mesh bounds and the centres of the six faces, in the world. */
  readonly center: Vec3
  readonly faces: { readonly [K in "bottom" | "top" | "left" | "right" | "back" | "front"]: Vec3 }
  /** A world-aligned box around the face centres: the mesh bounds for a piece that isn't turned. */
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 }
}

/** The editor's selection pivot and gizmo, and measuring a piece through them. */
export class Handler extends Context.Service<Handler, {
  /** The selection's pivot choice and the gizmo's transform; nothing selected is an error. */
  readonly pivot: (slot: number) => Effect.Effect<PivotState, DriverError>
  /** Sets the selection's pivot (the choice stays with the piece, as the inspector's buttons do) and reads it back. */
  readonly setPivot: (slot: number, choice: PivotChoice) => Effect.Effect<PivotState, DriverError>
  /** Selects the piece and measures it through the pivot choices, leaving its own choice and the selection as found. */
  readonly measure: (slot: number, id: number) => Effect.Effect<Measurement, DriverError>
}>()("ballest/driver/Handler") {
  static readonly make = Effect.gen(function*() {
    const channel = yield* Channel
    const plugin = yield* Plugin

    const callx = (slot: number, call: string, name: string) =>
      Effect.gen(function*() {
        const replies = yield* channel.send(slot, `callx ${HANDLER} ${call}`)
        const value = callxValue(replies, name)
        if (value === null) return yield* fail(`the handler didn't answer ${call}: ${replies.join(" | ")}`)
        return value
      })

    const selectionTransform = (slot: number) =>
      Effect.gen(function*() {
        const replies = yield* channel.send(slot, `callx ${HANDLER} GetSelectionTransform ${LIVE}`)
        const ok = callxValue(replies, "ReturnValue")
        const hex = callxValue(replies, "OutTransform")
        const transform = hex === null ? null : decodeTransform(hex)
        if (ok !== "01" || transform === null) {
          return yield* fail(`no selection transform (is a piece selected?): ${replies.join(" | ")}`)
        }
        return transform
      })

    const pivot = Effect.fn("Handler.pivot")(function*(slot: number) {
      const choice = pivotFromByte(yield* callx(slot, `GetSelectionPivotChoice ${LIVE}`, "ReturnValue"))
      if (choice === null) return yield* fail("the handler answered with a pivot choice this driver doesn't know")
      return { choice, gizmo: yield* selectionTransform(slot) } satisfies PivotState
    })

    const setPivot = Effect.fn("Handler.setPivot")(function*(slot: number, choice: PivotChoice) {
      const replies = yield* channel.send(
        slot,
        `callx ${HANDLER} SetSelectionPivot ${LIVE} | u8:${PIVOT_CHOICES.indexOf(choice)}`
      )
      if (!replies.some((r) => r.startsWith("callx SetSelectionPivot") && r.endsWith(" ok"))) {
        return yield* fail(`setting the pivot: ${replies.join(" | ")}`)
      }
      return yield* pivot(slot)
    })

    const select = (slot: number, ids: ReadonlyArray<number>) => plugin.call(slot, "select", { ids })

    const measure = Effect.fn("Handler.measure")(function*(slot: number, id: number) {
      const before = (yield* decodePieces(yield* plugin.call(slot, "selection"))).pieces.map((p) => p.id)
      const piece = (yield* decodePieces(yield* plugin.call(slot, "pieces"))).pieces.find((p) => p.id === id)
      if (piece === undefined) return yield* fail(`no piece ${id} in the open map`)
      yield* select(slot, [id])
      const own = yield* pivot(slot)
      const at = (choice: PivotChoice) => setPivot(slot, choice).pipe(Effect.map((s) => s.gizmo.location))
      const origin = yield* at("Default")
      const center = yield* at("Center")
      const faces = {
        bottom: yield* at("Bottom"),
        top: yield* at("Top"),
        left: yield* at("Left"),
        right: yield* at("Right"),
        back: yield* at("Back"),
        front: yield* at("Front")
      }
      yield* setPivot(slot, own.choice)
      yield* select(slot, before)
      const points = [center, ...Object.values(faces)]
      const axis = (i: 0 | 1 | 2, pick: (...v: Array<number>) => number) => pick(...points.map((p) => p[i]))
      return {
        id,
        class: piece.class,
        pivot: own.choice,
        gizmo: own.gizmo,
        origin,
        center,
        faces,
        bounds: {
          min: [axis(0, Math.min), axis(1, Math.min), axis(2, Math.min)],
          max: [axis(0, Math.max), axis(1, Math.max), axis(2, Math.max)]
        }
      } satisfies Measurement
    })

    return Handler.of({ pivot, setPivot, measure })
  })

  static readonly layer = Layer.effect(Handler, Handler.make).pipe(
    Layer.provide(Layer.mergeAll(Channel.layer, Plugin.layer))
  )
}
