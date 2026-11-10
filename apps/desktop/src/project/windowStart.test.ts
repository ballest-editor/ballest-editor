import { assert, describe, it } from "@effect/vitest"
import type { WindowEntry } from "./WindowRegistry"
import { decideStart } from "./windowStart"

const untitled: WindowEntry = { pid: 2, project: null, choosing: false }
const on = (project: string): WindowEntry => ({ pid: 4, project, choosing: false })

const decide = (options: { readonly requested?: string; readonly others?: ReadonlyArray<WindowEntry> }) =>
  decideStart({ requested: options.requested ?? null, others: options.others ?? [], same: (a, b) => a === b })

const CHOOSER = { project: null, chooser: true }

describe("decideStart", () => {
  it("without --project, always starts on the welcome window", () => {
    assert.deepStrictEqual(decide({}), CHOOSER)
    assert.deepStrictEqual(decide({ others: [on("/b")] }), CHOOSER)
  })

  it("--project goes straight there, whatever else is open", () => {
    assert.deepStrictEqual(decide({ requested: "/b", others: [untitled, on("/a")] }), { project: "/b", chooser: false })
  })

  it("--project on a project open elsewhere chooses", () => {
    assert.deepStrictEqual(decide({ requested: "/b", others: [on("/b")] }), CHOOSER)
  })
})
