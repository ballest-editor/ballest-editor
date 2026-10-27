import { describe, expect, it } from "@effect/vitest"
import { flyingActions, isMovementChord, type MovementLookMode, needsLook, sharedKeysFlyFreely } from "./flyKeys"
import { defaultKeybinds } from "./Keybinds"

const flying = (mode: MovementLookMode, looking: boolean, ...held: ReadonlyArray<string>) =>
  [...flyingActions(defaultKeybinds, mode, looking, (b) => held.includes(b))].sort()

describe("needsLook", () => {
  it("follows the mode", () => {
    expect(needsLook("nothing", "moveForward")).toBe(false)
    expect(needsLook("conflicting", "moveUp")).toBe(false)
    expect(needsLook("upDown", "moveUp")).toBe(true)
    expect(needsLook("upDown", "moveDown")).toBe(true)
    expect(needsLook("upDown", "moveLeft")).toBe(false)
    expect(needsLook("all", "moveLeft")).toBe(true)
  })

  it("only nothing lets shared keys fly freely", () => {
    expect(sharedKeysFlyFreely("all")).toBe(false)
    expect(sharedKeysFlyFreely("conflicting")).toBe(false)
    expect(sharedKeysFlyFreely("nothing")).toBe(true)
  })
})

describe("flyingActions", () => {
  it("nothing: every key flies any time, W included", () => {
    expect(flying("nothing", false, "KeyW")).toEqual(["moveForward"])
    expect(flying("nothing", false, "KeyA", "Space")).toEqual(["moveLeft", "moveUp"])
  })

  it("conflicting: plain keys fly any time, W only while looking or another key flies", () => {
    expect(flying("conflicting", false, "KeyA", "Space")).toEqual(["moveLeft", "moveUp"])
    expect(flying("conflicting", false, "KeyW")).toEqual([])
    expect(flying("conflicting", true, "KeyW")).toEqual(["moveForward"])
    expect(flying("conflicting", false, "KeyW", "KeyD")).toEqual(["moveForward", "moveRight"])
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
