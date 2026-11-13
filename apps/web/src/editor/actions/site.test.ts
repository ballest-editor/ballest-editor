import type { SitePrefab } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { Catalog, indexCatalog } from "../../domain/Catalog"
import { DESKTOP } from "../../test/capabilities"
import { makeTestDisk, projectPrefabFile, TEST_STEAM_ID, type TestDisk, userPrefabFile } from "../../test/desktopBridge"
import { layerFor, s, startPrefabMap } from "../../test/editorActions"
import { PREFAB_TEXT } from "../../test/prefabs"
import { repoRoot } from "../../test/samples"
import { useEditor } from "../store"
import { checkPrefabs } from "./prefabs"
import {
  loadSiteAccountEffect,
  placeSitePrefabEffect,
  signInToSiteEffect,
  signOutOfSiteEffect,
  takeSitePrefabEffect,
  uploadPrefabEffect
} from "./site"

const parsed = Schema.decodeUnknownSync(Catalog)(
  JSON.parse(fs.readFileSync(path.join(repoRoot, "assets", "catalog.json"), "utf8"))
)

const sitePrefab = (slug: string, name: string): SitePrefab & { readonly text: string; readonly thumb: null } => ({
  slug,
  name,
  description: "",
  uploader: { steamId: TEST_STEAM_ID, name: "Robin" },
  updatedAt: "2026-11-01T00:00:00.000Z",
  pieces: 2,
  favorites: 0,
  text: PREFAB_TEXT,
  thumb: null
})
const LOOP = sitePrefab("loop-de-loop", "Loop de loop")

/** What was notified of `kind`, toast or inbox. */
const notices = (kind: string) => [...s().notifications, ...s().toasts].filter((n) => n.kind === kind)

/** A map open in the disk's project, on the desktop, signed out, and the site holding `LOOP`. */
const started = (disk: TestDisk) =>
  startPrefabMap(indexCatalog(parsed), { x: 3000, y: 0, z: 9000 }, () => {
    useEditor.setState({ siteAccount: { _tag: "SignedOut" }, capabilities: DESKTOP })
    disk.site.prefabs.push(LOOP)
  })

describe("ballestrecords.com actions", () => {
  it.effect("place a site prefab as an instance of a copy in the project, kept once however often it is placed", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* started(disk)
      yield* placeSitePrefabEffect(LOOP)
      yield* placeSitePrefabEffect(LOOP)
      assert.strictEqual(disk.files.get(projectPrefabFile("Loop_de_loop")), PREFAB_TEXT)
      assert.deepStrictEqual(s().prefabs.map(({ name, tier }) => `${tier}/${name}`), ["project/Loop_de_loop"])
      const linked = s().doc.structure.tree.flatMap((node) =>
        node.kind === "group" && node.prefab !== undefined ? [`${node.prefab.tier}/${node.prefab.name}`] : []
      )
      assert.deepStrictEqual(linked, ["project/Loop_de_loop", "project/Loop_de_loop"])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("take a site prefab under a free name when the tier has another of its name, and use that copy again", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* started(disk)
      disk.files.set(
        userPrefabFile("Loop_de_loop"),
        PREFAB_TEXT.replace("\"version\"", "\"note\":\"mine\",\"version\"")
      )
      yield* checkPrefabs
      const ref = yield* takeSitePrefabEffect(LOOP, "user")
      assert.deepStrictEqual(ref, { tier: "user", name: "Loop_de_loop_2" })
      assert.strictEqual(disk.files.get(userPrefabFile("Loop_de_loop_2")), PREFAB_TEXT)
      assert.deepStrictEqual(yield* takeSitePrefabEffect(LOOP, "user"), ref)
      assert.deepStrictEqual(s().prefabs.filter((p) => p.tier === "user").map((p) => p.name).sort(), [
        "Loop_de_loop",
        "Loop_de_loop_2"
      ])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("sign in and out, and keep what main says in the store", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* started(disk)
      yield* loadSiteAccountEffect
      assert.deepStrictEqual(s().siteAccount, { _tag: "SignedOut" })
      disk.site.signIns.push({ _tag: "Cancelled" }, {
        _tag: "Failed",
        message: "The browser didn't come back in time."
      })
      yield* signInToSiteEffect
      yield* signInToSiteEffect
      assert.deepStrictEqual(s().siteAccount, { _tag: "SignedOut" })
      assert.deepStrictEqual(notices("siteSignInFailed").map((n) => n.body), ["The browser didn't come back in time."])
      yield* signInToSiteEffect
      assert.deepInclude(s().siteAccount, { _tag: "SignedIn", steamId: TEST_STEAM_ID })
      yield* signOutOfSiteEffect
      assert.deepStrictEqual(s().siteAccount, { _tag: "SignedOut" })
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("upload a tier's prefab, link the notification to its page, and say why the site refused one", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* started(disk)
      disk.files.set(userPrefabFile("Bridge"), PREFAB_TEXT)
      yield* checkPrefabs
      const bridge = { tier: "user", name: "Bridge" } as const
      const fields = { name: "Bridge", description: "Over the gap.", tags: ["Structure"] } as const
      yield* signInToSiteEffect
      assert.isTrue(yield* uploadPrefabEffect(bridge, fields))
      assert.deepStrictEqual(disk.site.uploads.map((upload) => [upload.prefab, upload.fields.tags, upload.text]), [[
        bridge,
        ["Structure"],
        PREFAB_TEXT
      ]])
      assert.deepStrictEqual(notices("prefabUploaded")[0]?.actions, [{
        label: "View it",
        command: { _tag: "OpenExternal", url: "https://ballestrecords.com/prefab/uploaded-1" }
      }])

      disk.site.uploadAnswers.push({ _tag: "Refused", problems: ["Give it a name."] }, { _tag: "SignedOut" })
      assert.isFalse(yield* uploadPrefabEffect(bridge, fields))
      assert.deepStrictEqual(notices("prefabUploadRefused").map((n) => n.body), ["Give it a name."])
      // a token the site no longer takes: the panel shows Sign in again
      assert.isFalse(yield* uploadPrefabEffect(bridge, fields))
      assert.deepStrictEqual(s().siteAccount, { _tag: "SignedOut" })
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
