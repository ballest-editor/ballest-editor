import { Context, Effect, FileSystem, Layer, Path } from "effect"
import { Channel } from "./channel.ts"
import { decodePieces } from "./handler.ts"
import { Plugin } from "./plugin.ts"
import { PROBE_FILE, PROBE_NAME, type ProbeItem, probeMap } from "./probe.ts"
import { type DriverError, fail, io, Slots } from "./slots.ts"

const OPEN_TIMEOUT_MS = 45_000

export interface OpenedProbe {
  readonly file: string
  /** The pieces the editor shows, the start included. */
  readonly pieces: ReadonlyArray<{ readonly id: number; readonly class: string }>
}

/**
 * The slot's probe map (probe.ts): written with the pieces a probe needs and opened in the editor from the Create
 * page, by way of the main menu (`open Map_MainMenu`, then `openmap`), which is where the game reads the file. Reset
 * to empty when the probe is done.
 */
export class Probe extends Context.Service<Probe, {
  readonly open: (slot: number, pieces: ReadonlyArray<ProbeItem>) => Effect.Effect<OpenedProbe, DriverError>
  readonly reset: (slot: number) => Effect.Effect<void, DriverError>
}>()("ballest/driver/Probe") {
  static readonly make = Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const slots = yield* Slots
    const channel = yield* Channel
    const plugin = yield* Plugin

    const write = (slot: number, pieces: ReadonlyArray<ProbeItem>) =>
      Effect.gen(function*() {
        const file = path.join(slots.paths(slot).maps, PROBE_FILE)
        yield* io(fs.makeDirectory(path.dirname(file), { recursive: true }), "creating the maps folder")
        yield* io(fs.writeFileString(file, probeMap(pieces)), "writing the probe map")
        return file
      })

    const open = Effect.fn("Probe.open")(function*(slot: number, pieces: ReadonlyArray<ProbeItem>) {
      const file = yield* write(slot, pieces)
      const menu = yield* channel.send(slot, "open Map_MainMenu", 30_000)
      if (!menu.some((r) => r.endsWith("-> ok"))) return yield* fail(`the main menu didn't open: ${menu.join(" | ")}`)
      const started = Date.now()
      // The Create page's entries take a moment to exist after the menu is up.
      let opened = false
      while (!opened && Date.now() - started < OPEN_TIMEOUT_MS) {
        const replies = yield* channel.send(slot, `openmap ${PROBE_NAME}`, 30_000)
        opened = replies.some((r) => r.endsWith("-> ok"))
        if (!opened) yield* Effect.sleep("1 second")
      }
      if (!opened) return yield* fail(`the probe map didn't open in ${OPEN_TIMEOUT_MS / 1000} s`)
      // Then the editor, with the file's pieces in it (the start, and one per piece asked for).
      while (Date.now() - started < OPEN_TIMEOUT_MS) {
        yield* Effect.sleep("1 second")
        const shown = yield* plugin.call(slot, "pieces").pipe(
          Effect.flatMap(decodePieces),
          Effect.map((r) => r.pieces),
          Effect.orElseSucceed(() => [] as Array<{ id: number; class: string }>)
        )
        if (shown.length >= pieces.length + 1) return { file, pieces: shown } satisfies OpenedProbe
      }
      return yield* fail(`the editor didn't show the probe's pieces in ${OPEN_TIMEOUT_MS / 1000} s`)
    })

    const reset = Effect.fn("Probe.reset")(function*(slot: number) {
      yield* write(slot, [])
    })

    return Probe.of({ open, reset })
  })

  static readonly layer = Layer.effect(Probe, Probe.make).pipe(
    Layer.provide(Layer.mergeAll(Channel.layer, Plugin.layer, Slots.layer))
  )
}
