import { describe, expect, it } from "@effect/vitest"
import { flyingActions, isMovementChord, type MovementLookMode, needsLook } from "./flyKeys"
import { defaultKeybinds } from "./Keybinds"

const flying = (mode: MovementLookMode, looking: boolean, ...held: ReadonlyArray<string>) =>
  [...flyingActions(defaultKeybinds, mode, looking, (b) => held.includes(b))].sort()

describe("needsLook", () => {
  it("follows the mode", () => {
    expect(needsLook("none", "moveUp")).toBe(false)
    expect(needsLook("upDown", "moveUp")).toBe(true)
    expect(needsLook("upDown", "moveDown")).toBe(true)
    expect(needsLook("upDown", "moveLeft")).toBe(false)
    expect(needsLook("all", "moveLeft")).toBe(true)
  })
})

describe("flyingActions", () => {
  it("none: plain keys fly any time, W only while looking or another key flies", () => {
    expect(flying("none", false, "KeyA", "Space")).toEqual(["moveLeft", "moveUp"])
    expect(flying("none", false, "KeyW")).toEqual([])
    expect(flying("none", true, "KeyW")).toEqual(["moveForward"])
    expect(flying("none", false, "KeyW", "KeyD")).toEqual(["moveForward", "moveRight"])
  })

  it("upDown: up/down need look, and don't let W fly on their own", () => {
    expect(flying("upDown", false, "Space", "ShiftLeft", "KeyS")).toEqual(["moveBack"])
    expect(flying("upDown", false, "KeyW", "Space")).toEqual([])
    expect(flying("upDown", false, "KeyW", "KeyA")).toEqual(["moveForward", "moveLeft"])
    expect(flying("upDown", true, "Space", "KeyW")).toEqual(["moveForward", "moveUp"])
  })

  it("all: nothing flies without looking", () => {
    expect(flying("all", false, "KeyA", "KeyS", "Space", "KeyW")).toEqual([])
    expect(flying("all", true, "KeyA", "KeyW")).toEqual(["moveForward", "moveLeft"])
  })
})

describe("isMovementChord", () => {
  it("matches movement bindings only", () => {
    expect(isMovementChord(defaultKeybinds, "KeyW")).toBe(true)
    expect(isMovementChord(defaultKeybinds, "KeyE")).toBe(false)
  })
})
