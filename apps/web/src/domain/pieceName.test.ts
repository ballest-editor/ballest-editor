import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { repoRoot } from "../test/samples"
import { Catalog, paletteSections } from "./Catalog"
import { inSizeOrder, pieceDisplayName, pieceLabelOf, pieceTitleOf, sizeScalesOf, withOrdinals } from "./pieceName"

const game = (displayName: string, className: string) => pieceDisplayName({ displayName, className })

describe("pieceTitleOf", () => {
  it("sets the size apart from the name, and leaves a piece with no size alone", () => {
    assert.strictEqual(pieceTitleOf({ displayName: "Curve1 M", className: "BP_Ramp_Curve1" }), "Curve 1 · Medium")
    assert.strictEqual(pieceTitleOf({ displayName: "Bevel_H Cap", className: "Bevel_Half_Cap" }), "Bevel Half Cap")
  })
})

describe("pieceDisplayName", () => {
  it("takes a trailing size off the name", () => {
    assert.deepStrictEqual(game("Curve1 S", "BP_Ramp_Curve_Short1"), { name: "Curve 1", size: "S" })
    assert.deepStrictEqual(game("Curve1 M", "BP_Ramp_Curve1"), { name: "Curve 1", size: "M" })
    assert.deepStrictEqual(game("Curve1 L", "BP_Ramp_Curve_Long1"), { name: "Curve 1", size: "L" })
    assert.deepStrictEqual(game("Quarter Curve Small", "BP_Pipe_Quarter_Small"), { name: "Quarter Curve", size: "S" })
  })

  it("takes a leading M as a size only when the class says Medium", () => {
    assert.deepStrictEqual(game("M Full Bowl", "MP_SM_FullMediumBowl"), { name: "Full Bowl", size: "M" })
    assert.deepStrictEqual(game("M Thing", "BP_Thing"), { name: "M Thing", size: undefined })
  })

  it("expands the bevel families, and drops a letter that only repeats the category", () => {
    assert.strictEqual(game("Bevel_F Straight", "Bevel_Full_Straight").name, "Bevel Full Straight")
    assert.strictEqual(game("Bevel_H Cap", "Bevel_Half_Cap").name, "Bevel Half Cap")
    assert.strictEqual(game("Bevel_T Ring", "Bevel_Tall_Ring").name, "Bevel Tall Ring")
    assert.strictEqual(game("Bevel_TC Concave", "Bevel_Tall_CornerConcave").name, "Bevel Tall Corner Concave")
    assert.strictEqual(game("Bevel_P Rail", "Bevel_Rail").name, "Bevel Rail")
  })

  it("reads S as Shallow, not Small, where the class says so", () => {
    assert.deepStrictEqual(game("Bevel_C Hump S", "Bevel_Half_ShallowCornerHump"), {
      name: "Bevel Corner Hump Shallow",
      size: undefined
    })
    assert.deepStrictEqual(game("Bevel_F Scoop S2", "Bevel_Full_ShallowShortScoop"), {
      name: "Bevel Full Scoop Shallow 2",
      size: undefined
    })
  })

  it("reads D from the class: Steep on a hump, Deep on a scoop", () => {
    assert.strictEqual(game("Bevel_C Hump D", "Bevel_Half_SteepCornerHump").name, "Bevel Corner Hump Steep")
    assert.strictEqual(game("Bevel_C Scoop D", "Bevel_Half_DeepCornerScoop").name, "Bevel Corner Scoop Deep")
  })

  it("reads L and R as a hand, not a size, on a handed class, and takes the hand from the game's name", () => {
    assert.deepStrictEqual(game("Bevel_F CScoop L", "Bevel_Full_ShortUScoop_L"), {
      name: "Bevel Full C Scoop Left",
      size: undefined
    })
    assert.strictEqual(game("Bevel_F SideRamp L", "Bevel_Full_ShallowSideKicker_R").name, "Bevel Full Side Ramp Left")
    assert.strictEqual(game("Bevel_H SCurveR", "Bevel_Half_SSurveR").name, "Bevel Half S Curve Right")
  })

  it("expands the tube and shape letters and keeps numbers", () => {
    assert.strictEqual(game("Bend H 45", "BP_GlossyRed_Half_TubeLong_Bend_45").name, "Bend Half 45")
    assert.strictEqual(game("Corner F 90", "BP_GlossyRed_Tube_Bend_90").name, "Corner Full 90")
    assert.strictEqual(game("Q Sphere", "BP_GlossyRed_QuarterSphere").name, "Quarter Sphere")
    assert.strictEqual(game("Fake Spotlight 2", "MP_LightCard_02").name, "Fake Spotlight 2")
  })

  it("splits joined words, title cases, and leaves a letter it can't place", () => {
    assert.strictEqual(game("CornerRamp", "MP_SM_CornerScoop").name, "Corner Ramp")
    assert.strictEqual(game("Half tunnel", "MP_TunnelHalf").name, "Half Tunnel")
    assert.strictEqual(game("Bevel_S Arch T", "Bevel_Arch").name, "Bevel Arch T")
  })

  it("names a class with no game name, without its prefix, material or hash", () => {
    const name = (className: string) => pieceDisplayName({ className }).name
    assert.strictEqual(name("MP_PlayerStart"), "Player Start")
    assert.strictEqual(name("BP_Bevel_Full_Ring"), "Bevel Full Ring")
    assert.strictEqual(name("BP_UGCShapeDecal"), "UGC Shape Decal")
    assert.strictEqual(name("AJ_500_kicker1_M_ClearCoat_M_OutlineEdges"), "500 Kicker 1 Clear Coat Outline Edges")
    assert.strictEqual(name("Boolean_04A2A514_MI_ArenaOrange"), "Boolean Arena Orange")
    assert.strictEqual(name("Boolean_84A9059E_MI_ArenaRed_MI_ArenaRed"), "Boolean Arena Red")
    assert.strictEqual(name("Box_005FE104_WorldGridMaterial"), "Box")
  })

  it("never reads a size out of a class name", () => {
    assert.deepStrictEqual(pieceDisplayName({ className: "Bevel_Half_MediumRamp" }), {
      name: "Bevel Half Medium Ramp",
      size: undefined
    })
  })

  it("falls back to the class when nothing else is left", () => {
    assert.strictEqual(pieceDisplayName({ className: "BP_" }).name, "BP_")
    assert.strictEqual(pieceDisplayName({ className: "Foo", displayName: "" }).name, "Foo")
    assert.strictEqual(pieceDisplayName({ className: "Foo", displayName: null }).name, "Foo")
  })
})

describe("pieceLabelOf", () => {
  it("writes the size out", () => {
    assert.strictEqual(pieceLabelOf({ displayName: "Curve1 S", className: "BP_Ramp_Curve_Short1" }), "Curve 1 Small")
    assert.strictEqual(pieceLabelOf({ displayName: "Goal", className: "BP_Checkpoint" }), "Goal")
  })
})

describe("inSizeOrder", () => {
  const named = (...names: ReadonlyArray<string>) =>
    names.map((displayName) => ({ displayName, className: "BP_Piece" }))
  const order = (...names: ReadonlyArray<string>) => inSizeOrder(named(...names)).map((p) => p.displayName)

  it("sorts a family S, M, L", () => {
    assert.deepStrictEqual(order("Curve2 M", "Curve2 S", "Curve2 L"), ["Curve2 S", "Curve2 M", "Curve2 L"])
  })

  it("brings a family together where its first piece stands", () => {
    assert.deepStrictEqual(order("Track S", "Track L", "Curve S", "Curve L", "Track M"), [
      "Track S",
      "Track M",
      "Track L",
      "Curve S",
      "Curve L"
    ])
  })

  it("leaves a piece with no size where it is, even with a family's name", () => {
    assert.deepStrictEqual(order("Goal", "Curve L", "Curve", "Curve S"), ["Goal", "Curve S", "Curve L", "Curve"])
  })

  it("keeps file order between pieces of one name and size", () => {
    const pieces = [
      { displayName: "Curve L", className: "BP_A" },
      { displayName: "Curve L", className: "BP_B" },
      { displayName: "Curve S", className: "BP_C" }
    ]
    assert.deepStrictEqual(inSizeOrder(pieces).map((p) => p.className), ["BP_C", "BP_A", "BP_B"])
  })
})

describe("withOrdinals", () => {
  const labels = (...classNames: ReadonlyArray<string>) =>
    withOrdinals(classNames.map((className) => ({ className }))).map(pieceLabelOf)

  it("numbers the pieces that read the same from 2, and leaves the first and the rest alone", () => {
    assert.deepStrictEqual(
      labels(
        "Boolean_04A2A514_MI_ArenaWhite",
        "Box_005FE104",
        "Boolean_1459EA0F_MI_ArenaWhite",
        "Boolean_3024C8A1_MI_ArenaWhite"
      ),
      ["Boolean Arena White", "Box", "Boolean Arena White 2", "Boolean Arena White 3"]
    )
  })

  it("skips a number another piece's name already has", () => {
    assert.deepStrictEqual(labels("Box_005FE104", "Box_2", "Box_84A9059E"), ["Box", "Box 2", "Box 3"])
  })

  it("keeps the size out of the comparison's way: sizes of one name aren't duplicates, and the number comes before one", () => {
    const pieces = [
      { displayName: "Curve1 S", className: "BP_A" },
      { displayName: "Curve1 M", className: "BP_B" },
      { displayName: "Curve1 M", className: "BP_C" }
    ]
    assert.deepStrictEqual(withOrdinals(pieces).map(pieceTitleOf), [
      "Curve 1 · Small",
      "Curve 1 · Medium",
      "Curve 1 2 · Medium"
    ])
  })

  it("keeps the class, and hands back a piece that needs no number as it came", () => {
    const pieces = [{ className: "Box_005FE104" }, { className: "Box_84A9059E" }]
    const [first, second] = withOrdinals(pieces)
    assert.strictEqual(first, pieces[0])
    assert.strictEqual(second?.className, "Box_84A9059E")
  })
})

// assets/catalog.json is git-tracked extractor output; the suite skips it if a checkout lacks it.
const catalogPath = path.join(repoRoot, "assets", "catalog.json")

describe.skipIf(!fs.existsSync(catalogPath))("the real catalog", () => {
  const pieces = () => Schema.decodeUnknownSync(Catalog)(JSON.parse(fs.readFileSync(catalogPath, "utf8"))).pieces

  it("names every piece without an underscore or a material marker", () => {
    for (const piece of pieces()) {
      const { name } = pieceDisplayName(piece)
      assert.notMatch(name, /_/, piece.className)
      assert.notMatch(name, /\b(?:MI|BP|MP)\b/, piece.className)
    }
  })

  it("tells every piece in the in-game browser apart", () => {
    const palette = pieces().filter((p) => p.inPalette !== false)
    const labels = palette.map((p) => `${p.category ?? ""}: ${pieceLabelOf(p)}`)
    assert.deepStrictEqual(labels.filter((label, i) => labels.indexOf(label) !== i), [])
  })

  it("tells every piece in a palette section apart, Hidden included", () => {
    for (const section of paletteSections(pieces())) {
      const labels = section.pieces.map(pieceLabelOf)
      assert.deepStrictEqual(labels.filter((label, i) => labels.indexOf(label) !== i), [], section.name)
    }
  })

  it("lists every family in the palette together, smallest first", () => {
    for (const section of paletteSections(pieces())) {
      const sized = section.pieces.map(pieceDisplayName).filter((piece) => piece.size !== undefined)
      const runs = sized.map((piece) => piece.name).filter((name, i, names) => name !== names[i - 1])
      assert.deepStrictEqual(runs, [...new Set(runs)], section.name)
      sized.forEach((piece, i) => {
        const previous = sized[i - 1]
        if (previous?.name !== piece.name) return
        assert.isAtMost("SML".indexOf(previous.size ?? ""), "SML".indexOf(piece.size ?? ""), piece.name)
      })
    }
  })
})

describe("sizeScalesOf", () => {
  const piece = (displayName: string) => ({ className: "BP_Test", displayName })
  const scales = (...names: ReadonlyArray<string>) => {
    const pieces = names.map(piece)
    const of = sizeScalesOf(pieces)
    return pieces.map((p) => of.get(p))
  }

  it("draws a family of three at 60%, 80% and 100%, in any order", () => {
    assert.deepStrictEqual(scales("Curve1 S", "Curve1 M", "Curve1 L"), [0.6, 0.8, 1])
    assert.deepStrictEqual(scales("Curve2 M", "Curve2 S", "Curve2 L"), [0.8, 0.6, 1])
  })

  it("measures from the family's largest, so a family without an L tops out at its M", () => {
    assert.deepStrictEqual(scales("Track S", "Track M"), [0.8, 1])
    assert.deepStrictEqual(scales("Track S", "Track L"), [0.6, 1])
  })

  it("keeps families apart, and fills the frame with a piece on its own or with no size", () => {
    assert.deepStrictEqual(scales("Curve1 S", "Track L", "Ramp M", "Kicker"), [1, 1, 1, 1])
  })
})
