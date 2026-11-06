/**
 * Instances following their definitions (docs/DESKTOP.md § Prefabs): an instance whose link names a file that has moved
 * on is updated in place while it is unmodified, and reported otherwise. Internal to `editor/actions`, not re-exported.
 */
import type { PrefabInfo, PrefabRef } from "@ballest/contracts"
import { Effect } from "effect"
import { isSamePrefab } from "../../domain/prefab"
import { checkInstance, definitionOf, instancesIn } from "../../domain/prefabInstance"
import { MapCodec } from "../../services/MapCodec"
import { Platform } from "../../services/Platform"
import { tabLabelOf, tabStateOf, useEditor } from "../store"

/** A prefab's file, and what it decodes to. */
export const readPrefabFile = Effect.fnUntraced(function*(ref: PrefabRef) {
  const read = yield* (yield* Platform).readPrefab(ref)
  const prefab = yield* MapCodec.use((codec) => codec.decodePrefab(read.text, useEditor.getState().catalogIndex))
  return { prefab, read }
})

/** A definition, as an instance takes it. The catalog says which list each property goes in, so it has to be loaded. */
export const readDefinition = Effect.fn("readDefinition")(function*(ref: PrefabRef) {
  const { prefab, read } = yield* readPrefabFile(ref)
  return definitionOf(prefab, read, useEditor.getState().catalogIndex)
})

/** The instances of `ref` in tab `tabId`'s map; a definition's tab keeps none, its file having no place for a link. */
export const instancesInTab = (tabId: string, ref: PrefabRef) => {
  const tab = tabStateOf(useEditor.getState(), tabId)
  if (tab?.document.kind !== "map") return []
  return instancesIn(tab.doc.structure.tree).filter(({ prefab }) => isSamePrefab(prefab, ref))
}

/** The instances of `ref` in tabs `tabIds` that link to a file other than the one of hash `hash`, by tab. */
export const staleInstances = (tabIds: ReadonlyArray<string>, ref: PrefabRef, hash: string | undefined) =>
  tabIds.flatMap((tabId) => {
    const stale = instancesInTab(tabId, ref).filter(({ prefab }) => prefab.hash !== hash)
    return stale.length === 0 ? [] : [{ tabId, stale }]
  })

const countOf = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`

/** Tells what following a definition did, and offers the choice for what it couldn't follow. */
const report = (ref: PrefabRef, updated: number, edited: ReadonlyArray<string>) => {
  const { notify } = useEditor.getState()
  if (updated > 0) {
    notify("info", `Updated ${countOf(updated, "instance")} of ${ref.name}`, { kind: "prefabInstancesUpdated" })
  }
  if (edited.length === 0) return
  const command = { tier: ref.tier, name: ref.name }
  const [them, plainGroups] = edited.length === 1 ? ["it", "a plain group"] : ["them", "plain groups"]
  notify("info", `${countOf(edited.length, "instance")} of ${ref.name} didn't follow its definition`, {
    kind: "prefabInstancesEdited",
    body: `Edited here, in ${
      [...new Set(edited)].join(", ")
    }. Update replaces ${them} with the definition, and Detach keeps ${them} as ${plainGroups}.`,
    actions: [
      { label: "Update", command: { _tag: "UpdatePrefabInstances", ...command } },
      { label: "Detach", command: { _tag: "DetachPrefabInstances", ...command } }
    ]
  })
}

/** Brings tabs `tabIds` up to one definition; one that won't read leaves its instances as they are. */
const followOne = Effect.fnUntraced(function*(tabIds: ReadonlyArray<string>, info: PrefabInfo) {
  const tabs = staleInstances(tabIds, info, info.hash)
  if (tabs.length === 0) return
  const definition = yield* readDefinition(info)
  let updated = 0
  const edited: Array<string> = []
  for (const { stale, tabId } of tabs) {
    const state = useEditor.getState()
    const tab = tabStateOf(state, tabId)
    if (tab === undefined) continue
    const unmodified = stale.filter((group) => checkInstance(tab.doc, group, group.prefab).unmodified)
    updated += unmodified.length
    edited.push(...Array.from({ length: stale.length - unmodified.length }, () => tabLabelOf(tab)))
    state.updateInstances(tabId, unmodified.map(({ id }) => id), definition)
  }
  report(info, updated, edited)
})

/**
 * An instance whose definition has gone from its name, when a file of its tier has its hash: the definition was renamed
 * while its map was closed. The link moves to it.
 */
const relinkRenamed = (tabId: string) => {
  const s = useEditor.getState()
  const tab = tabStateOf(s, tabId)
  if (tab?.document.kind !== "map") return
  for (const { id, prefab } of instancesIn(tab.doc.structure.tree)) {
    const moved = s.prefabs.some((info) => isSamePrefab(info, prefab))
      ? undefined
      : s.prefabs.find(({ hash, tier }) => tier === prefab.tier && hash === prefab.hash)
    if (moved !== undefined) s.relinkInstances(tabId, [[id, { ...prefab, name: moved.name }]])
  }
}

/**
 * Brings tabs `tabIds` up to the definitions `infos`, each reported once. Nothing happens before the catalog is in:
 * startup goes through every tab once it is.
 */
export const followDefinitions = Effect.fn("followDefinitions")(
  function*(tabIds: ReadonlyArray<string>, infos: ReadonlyArray<PrefabInfo>) {
    if (useEditor.getState().catalogIndex === null) return
    for (const info of infos) {
      yield* followOne(tabIds, info).pipe(
        Effect.catch((error) => Effect.logWarning(`Couldn't follow the prefab ${info.name}`, error))
      )
    }
  }
)

/** A map just shown in tab `tabId`: its instances catch up with what happened while it was closed. */
export const followDefinitionsIn = Effect.fn("followDefinitionsIn")(function*(tabId: string) {
  relinkRenamed(tabId)
  yield* followDefinitions([tabId], useEditor.getState().prefabs)
})
