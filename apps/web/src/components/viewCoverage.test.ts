import { describe, expect, it } from "vitest"
import { viewIds } from "./viewIds"

interface DeclaredState {
  readonly views: ReadonlyArray<string>
}

const declared = import.meta.glob<Readonly<Record<string, DeclaredState>>>("../**/*.states.ts", {
  eager: true,
  import: "default"
})

describe("the app driver's coverage", () => {
  const states = Object.entries(declared).flatMap(([file, inFile]) =>
    Object.entries(inFile).map(([id, state]) => ({ file, id, views: state.views }))
  )
  const named = new Set(states.flatMap(({ views }) => views))
  const known = new Set(viewIds())

  it("has a state for every view", () => {
    expect([...known].filter((view) => !named.has(view)), "add a state in a *.states.ts file beside the view").toEqual(
      []
    )
  })

  it("names only views that exist", () => {
    const dead = states.flatMap(({ file, id, views }) =>
      views.filter((view) => !known.has(view)).map((view) => `${file} ${id}: ${view}`)
    )
    expect(dead).toEqual([])
  })

  it("names a view in every state", () => {
    expect(states.filter(({ views }) => views.length === 0).map(({ id }) => id)).toEqual([])
  })
})
