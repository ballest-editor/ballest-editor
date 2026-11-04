import { describe, expect, it } from "vitest"
import { diffPalette, parsePalette, parseWidgets } from "./ui.ts"

const palette = [
  "palette -> 2 categories",
  "category 0 Ramps header \"Ramps\" tiles 2 items 2 asset /Game/UI/DA_BallestRamps.DA_BallestRamps",
  "  0 Curve1 S /Game/Pieces/BP_Ramp_Curve_Short1.BP_Ramp_Curve_Short1_C",
  "  1 Bevel_C Hump S /Game/Pieces/Bevel_Half_ShallowCornerHump.Bevel_Half_ShallowCornerHump_C",
  "category 1 Objectives header \"Objectives\" tiles 1 items 2 asset /Game/UI/DA_Objectives.DA_Objectives",
  "  0 Goal /Game/Core/BP_Checkpoint.BP_Checkpoint_C",
  "  1 Checkpoint Disc /Game/Core/MP_ActualCheckpoint_Disc.MP_ActualCheckpoint_Disc_C"
]

describe("ui", () => {
  it("reads the palette's categories and items", () => {
    const got = parsePalette(palette)
    expect(got).toHaveLength(2)
    expect(got[0]?.name).toBe("Ramps")
    expect(got[0]?.items[1]).toEqual({
      name: "Bevel_C Hump S",
      classPath: "/Game/Pieces/Bevel_Half_ShallowCornerHump.Bevel_Half_ShallowCornerHump_C"
    })
    expect(got[1]?.tiles).toBe(1)
    expect(got[1]?.asset).toBe("/Game/UI/DA_Objectives.DA_Objectives")
  })

  it("diffs the palette against the catalog", () => {
    const diff = diffPalette(parsePalette(palette), [
      {
        objectPath: "/Game/Pieces/BP_Ramp_Curve_Short1.BP_Ramp_Curve_Short1_C",
        displayName: "Curve1 S",
        category: "Ramps",
        inPalette: true
      },
      {
        objectPath: "/Game/Core/BP_Checkpoint.BP_Checkpoint_C",
        displayName: "Finish",
        category: "Objectives",
        inPalette: true
      },
      {
        objectPath: "/Game/Core/MP_ActualCheckpoint_Disc.MP_ActualCheckpoint_Disc_C",
        displayName: "Checkpoint Disc",
        category: "Objectives",
        inPalette: false
      },
      { objectPath: "/Game/Core/MP_Old.MP_Old_C", displayName: "Old", category: "Misc", inPalette: true }
    ])
    expect(diff.missingFromCatalog.map((p) => p.name)).toEqual(["Bevel_C Hump S"])
    expect(diff.notMarkedInPalette).toEqual(["/Game/Core/MP_ActualCheckpoint_Disc.MP_ActualCheckpoint_Disc_C"])
    expect(diff.goneFromPalette).toEqual(["/Game/Core/MP_Old.MP_Old_C"])
    expect(diff.renamed).toEqual([{
      classPath: "/Game/Core/BP_Checkpoint.BP_Checkpoint_C",
      catalog: { displayName: "Finish", category: "Objectives" },
      game: { displayName: "Goal", category: "Objectives" }
    }])
    expect(diff.tileMismatch).toEqual([{ category: "Objectives", tiles: 1, items: 2 }])
  })

  it("reads a widget tree", () => {
    const got = parseWidgets([
      "widgets W_Details_C Transient 6 -> /Engine/Transient.W_Details_C_1",
      "W_Details_C W_Details_C_1 self-hit-test-invisible",
      "      HorizontalBox FlipActionsRow self-hit-test-invisible",
      "        Button FlipXAction collapsed disabled",
      "          TextBlock FlipXLabel visible \"Flip X\"",
      "          CheckBox Snap visible checked",
      "          CheckBox Grid visible unchecked",
      "  W_MapItem_C W_MapItem_C_7 visible class=/Game/P/BP_A.BP_A_C"
    ])
    expect(got).toHaveLength(7)
    expect(got[2]).toEqual({ depth: 4, class: "Button", name: "FlipXAction", visibility: "collapsed", enabled: false })
    expect(got[3]?.text).toBe("Flip X")
    expect(got[4]?.checked).toBe(true)
    expect(got[5]?.checked).toBe(false)
    expect(got[6]?.classPath).toBe("/Game/P/BP_A.BP_A_C")
  })
})
