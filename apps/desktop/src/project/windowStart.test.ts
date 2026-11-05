import { assert, describe, it } from "@effect/vitest"
import type { WindowEntry } from "./WindowRegistry"
import { decideStart } from "./windowStart"

const untitled: WindowEntry = { pid: 2, project: null, choosing: false }
const choosing: WindowEntry = { pid: 3, project: null, choosing: true }
const on = (project: string): WindowEntry => ({ pid: 4, project, choosing: false })

const decide = (options: {
  readonly requested?: string
  readonly lastUsed?: string
  readonly others?: ReadonlyArray<WindowEntry>
}) =>
  decideStart({
    requested: options.requested ?? null,
    lastUsed: options.lastUsed ?? null,
    others: options.others ?? [],
    same: (a, b) => a === b
  })

const CHOOSER = { project: null, chooser: true }

describe("decideStart", () => {
  it("alone, takes the last project, or Untitled Project", () => {
    assert.deepStrictEqual(decide({ lastUsed: "/a" }), { project: "/a", chooser: false })
    assert.deepStrictEqual(decide({}), { project: null, chooser: false })
  })

  it("beside Untitled Project, chooses, whatever it would have started on", () => {
    assert.deepStrictEqual(decide({ others: [untitled] }), CHOOSER)
    assert.deepStrictEqual(decide({ lastUsed: "/a", others: [untitled] }), CHOOSER)
  })

  it("chooses rather than open the last project twice", () => {
    assert.deepStrictEqual(decide({ lastUsed: "/a", others: [on("/a")] }), CHOOSER)
  })

  it("beside a window on another project, starts as usual", () => {
    assert.deepStrictEqual(decide({ lastUsed: "/a", others: [on("/b")] }), { project: "/a", chooser: false })
    assert.deepStrictEqual(decide({ others: [on("/b")] }), { project: null, chooser: false })
  })

  it("a window in the chooser is on no project: it blocks nothing", () => {
    assert.deepStrictEqual(decide({ lastUsed: "/a", others: [choosing] }), { project: "/a", chooser: false })
    assert.deepStrictEqual(decide({ others: [choosing] }), { project: null, chooser: false })
  })

  it("--project goes straight there, past Untitled Project and the last project", () => {
    assert.deepStrictEqual(
      decide({ requested: "/b", lastUsed: "/a", others: [untitled, on("/a")] }),
      { project: "/b", chooser: false }
    )
  })

  it("--project on a project open elsewhere chooses", () => {
    assert.deepStrictEqual(decide({ requested: "/b", others: [on("/b")] }), CHOOSER)
  })
})
