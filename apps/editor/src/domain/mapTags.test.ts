import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { listSamples, readSample } from "../test/samples"
import { newMapFile } from "./factory"
import { type LevelData, MapFile } from "./MapFile"
import {
  DIFFICULTIES,
  difficultyOf,
  hasTag,
  MAP_TYPE_TAG,
  TAG_GROUPS,
  tagNameOf,
  unknownTags,
  withDifficulty,
  withTag
} from "./mapTags"

const decodeSample = Schema.decodeSync(Schema.fromJsonString(MapFile))
const samples = listSamples().map((file) =>
  [file.name, decodeSample(readSample(file)).worldSettings.levelData] as const
)
const sample = (name: string) => {
  const found = samples.find(([file]) => file.includes(name))
  if (found === undefined) throw new Error(`no sample ${name}`)
  return found[1]
}
const tagsOf = (levelData: LevelData) => levelData.mapTags.gameplayTags.map((t) => t.tagName)
const ALL_TAGS = TAG_GROUPS.flatMap(({ group, tags }) => tags.map((tag) => tagNameOf(group, tag)))

describe("map tags", () => {
  it("knows every grouped tag in the samples", () => {
    for (const [name, levelData] of samples) {
      const grouped = unknownTags(levelData).filter((tag) => /^MapTags\.UGCTags\.\w+\./.test(tag))
      assert.deepStrictEqual(grouped, [], name)
    }
  })

  it("reads the difficulty from the tag; levelDifficulty stays Beginner in published maps", () => {
    assert.strictEqual(difficultyOf(sample("Bevel Up")), "medium")
    assert.strictEqual(difficultyOf(sample("Ballest Of The Mall")), "advanced")
    assert.strictEqual(difficultyOf(sample("A08 Lover 3")), "beginner")
    assert.strictEqual(sample("Ballest Of The Mall").levelDifficulty, "Beginner")
    assert.strictEqual(difficultyOf(sample("Waterfront")), undefined)
    // the old ungrouped form isn't a difficulty the editor sets
    const legacy = sample("Roundabout")
    assert.strictEqual(difficultyOf(legacy), undefined)
    assert.deepStrictEqual(unknownTags(legacy), [
      "MapTags.UGCTags.expert",
      "MapTags.UGCTags.tech",
      "MapTags.UGCTags.flow"
    ])
  })

  it("replaces the difficulty tag in place and sets levelDifficulty", () => {
    const before = sample("Bevel Up")
    const after = withDifficulty(before, "baller")
    assert.strictEqual(after.levelDifficulty, "Baller")
    assert.strictEqual(difficultyOf(after), "baller")
    const index = tagsOf(before).indexOf(tagNameOf("Difficulty", "medium"))
    assert.isAbove(index, 0)
    assert.strictEqual(tagsOf(after)[index], tagNameOf("Difficulty", "baller"))
    assert.strictEqual(tagsOf(after).length, tagsOf(before).length)
    for (const d of DIFFICULTIES) assert.strictEqual(withDifficulty(before, d.tag).levelDifficulty, d.level)
  })

  it("keeps the old ungrouped tags when setting a difficulty", () => {
    const legacy = sample("Happy Halloween")
    const after = withDifficulty(legacy, "medium")
    assert.deepStrictEqual(tagsOf(after), [...tagsOf(legacy), tagNameOf("Difficulty", "medium")])
  })

  it("adds the map type tag first, as the game writes it, when a map gets its first tag", () => {
    const fresh = newMapFile({ displayName: "A", creatorName: "B", createdAt: "" }).worldSettings.levelData
    assert.deepStrictEqual(tagsOf(fresh), [])
    const tagged = withTag(withDifficulty(fresh, "expert"), tagNameOf("Mood", "night"), true)
    assert.deepStrictEqual(tagsOf(tagged), [
      MAP_TYPE_TAG,
      tagNameOf("Difficulty", "expert"),
      tagNameOf("Mood", "night")
    ])
    assert.deepStrictEqual(tagsOf(withTag(tagged, tagNameOf("Mood", "night"), false)), tagsOf(tagged).slice(0, 2))
  })

  it("matches tags without case, like the game's FNames", () => {
    const levelData = sample("Roundabout")
    const lower = withTag(levelData, "MapTags.UGCTags.Gameplay.rpg", true)
    assert.isTrue(hasTag(lower, tagNameOf("Gameplay", "RPG")))
    assert.deepStrictEqual(unknownTags(lower), unknownTags(levelData))
    assert.strictEqual(withTag(lower, tagNameOf("Gameplay", "RPG"), true), lower)
  })

  it.each(samples)("keeps the tags it doesn't know in %s through every edit", (_, levelData) => {
    const unknown = unknownTags(levelData)
    let edited = withDifficulty(levelData, "expert")
    for (const tag of ALL_TAGS) edited = withTag(edited, tag, !hasTag(edited, tag))
    for (const tag of ALL_TAGS) edited = withTag(edited, tag, !hasTag(edited, tag))
    assert.deepStrictEqual(unknownTags(edited), unknown)
    for (const tag of ALL_TAGS) assert.strictEqual(hasTag(edited, tag), hasTag(levelData, tag), tag)
    // the unknown ones keep their order and their entries
    const kept = edited.mapTags.gameplayTags.filter((t) => unknown.includes(t.tagName))
    assert.deepStrictEqual(kept, levelData.mapTags.gameplayTags.filter((t) => unknown.includes(t.tagName)))
  })
})
