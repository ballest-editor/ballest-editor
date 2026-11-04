import { describe, expect, it } from "vitest"
import { callxValue, decodeTransform, pivotFromByte } from "./handler.ts"

// As the game answered for a ramp at (-3400, 800, 9000) with the Center pivot.
const reply =
  "callx GetSelectionTransform(OutTransform out: 96) -> 1 on /Game/Maps/LevelEditor/Map_LevelEditorMain.Map_LevelEditorMain.PersistentLevel.P_LevelEditorPawn_C_2147479698.SKGMLEHandler ok OutTransform=000000000000000000000000000000000000000000000000000000000000f03f000000000090aac00000000000008940002055432fb8c1400000000000000000 ReturnValue=01"

describe("handler", () => {
  it("reads an FTransform out of a callx reply", () => {
    const t = decodeTransform(callxValue([reply], "OutTransform") ?? "")
    expect(t?.rotation).toEqual([0, 0, 0, 1])
    expect(t?.location[0]).toBe(-3400)
    expect(t?.location[1]).toBe(800)
    expect(t?.location[2]).toBeCloseTo(9072.37, 2)
    expect(callxValue([reply], "ReturnValue")).toBe("01")
  })

  it("refuses what isn't a transform or didn't run", () => {
    expect(decodeTransform("00")).toBeNull()
    expect(callxValue(["callx SetSelectionPivot(Choice: 1) on x FAILED"], "ReturnValue")).toBeNull()
    expect(callxValue(["no instance of SKGMLEHandlerComponent"], "ReturnValue")).toBeNull()
  })

  it("names pivot choices by their enum byte", () => {
    expect(pivotFromByte("00")).toBe("Default")
    expect(pivotFromByte("01")).toBe("Center")
    expect(pivotFromByte("07")).toBe("Front")
    expect(pivotFromByte("09")).toBeNull()
  })
})
