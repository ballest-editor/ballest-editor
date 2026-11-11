import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { acquireSlot } from "./slotLock.ts"

const newDir = () => mkdtempSync(join(tmpdir(), "check-slots-"))

describe("acquireSlot", () => {
  it("holds a third run back until one of two ends, and says it is waiting", async () => {
    const dir = newDir()
    const first = await acquireSlot({ dir, slots: 2 })
    const second = await acquireSlot({ dir, slots: 2 })
    expect([first.index, second.index]).toEqual([1, 2])

    const told: Array<ReadonlyArray<string>> = []
    let thirdIndex: number | undefined
    const third = acquireSlot({ dir, slots: 2, pollMs: 50, onWait: (holders) => told.push(holders) }).then((slot) => {
      thirdIndex = slot.index
      return slot
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(thirdIndex).toBeUndefined()
    expect(told).toHaveLength(1)
    expect(told[0]?.[0]).toContain(`pid ${process.pid}`)

    first.release()
    expect((await third).index).toBe(1)
    second.release()
    ;(await third).release()
  })

  it("frees a slot whose run was killed", async () => {
    const dir = newDir()
    const module = new URL("./slotLock.ts", import.meta.url).href
    const holder = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const { acquireSlot } = await import(${JSON.stringify(module)});` +
        `await acquireSlot({ dir: ${JSON.stringify(dir)}, slots: 1 }); console.log("held"); setInterval(() => {}, 1000)`
      ],
      { stdio: ["ignore", "pipe", "inherit"] }
    )
    await new Promise((resolve) => holder.stdout.once("data", resolve))

    let waited = false
    const next = acquireSlot({ dir, slots: 1, pollMs: 50, onWait: () => (waited = true) })
    await new Promise((resolve) => setTimeout(resolve, 200))
    holder.kill("SIGKILL")
    const slot = await next
    expect(waited).toBe(true)
    expect(slot.index).toBe(1)
    slot.release()
  })
})
