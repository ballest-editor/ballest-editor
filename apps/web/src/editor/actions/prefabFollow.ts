/**
 * Instances following their definitions (docs/DESKTOP.md § Prefabs): an instance whose link names a file that has moved
 * on is updated in place while it is unmodified, and reported otherwise. Internal to `editor/actions`, not re-exported.
 */
import type { PrefabInfo, PrefabRef } from "@ballest/contracts"
import { Effect } from "effect"
import { counted } from "../../domain/groupSelection"
import { isSamePrefab } from "../../domain/prefab"
import { checkInstance, definitionOf, instancesIn, instancesOfPrefab } from "../../domain/prefabInstance"
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
  return instancesOfPrefab(tab.doc.structure.tree, ref)
}

/** The instances of `ref` in tabs `tabIds` that link to a file other than the one of hash `hash`, by tab. */
export const staleInstances = (tabIds: ReadonlyArray<string>, ref: PrefabRef, hash: string | undefined) =>
  tabIds.flatMap((tabId) => {
    const stale = instancesInTab(tabId, ref).filter(({ prefab }) => prefab.hash !== hash)
    return stale.length === 0 ? [] : [{ tabId, stale }]
  })

/** Tells what following a definition did, and offers the choice for what it couldn't follow. */
const report = (ref: PrefabRef, updated: number, edited: ReadonlyArray<string>) => {
  const { notify } = useEditor.getState()
  if (updated > 0) {
    notify("info", `Updated ${counted(updated, "instance")} of ${ref.name}`, { kind: "prefabInstancesUpdated" })
  }
  if (edited.length === 0) return
  const command = { tier: ref.tier, name: ref.name }
  const [them, plainGroups] = edited.length === 1 ? ["it", "a plain group"] : ["them", "plain groups"]
  notify("info", `${counted(edited.length, "instance")} of ${ref.name} didn't follow its definition`, {
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

/**
 * Brings tabs `tabIds` up to one definition, and answers how many instances took it. One that won't read leaves its
 * instances as they are. `quiet` keeps the updated ones out of the notification centre: whoever saved says so.
 */
const followOne = Effect.fnUntraced(function*(tabIds: ReadonlyArray<string>, info: PrefabInfo, quiet: boolean) {
  const tabs = staleInstances(tabIds, info, info.hash)
  if (tabs.length === 0) return 0
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
  report(info, quiet ? 0 : updated, edited)
  return updated
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
 * Brings tabs `tabIds` up to the definitions `infos`, each reported once, except that the one `saved` is left for the
 * caller to report: this answers how many of its instances took it. Nothing happens before the catalog is in: startup
 * goes through every tab once it is.
 */
export const followDefinitions = Effect.fn("followDefinitions")(
  function*(tabIds: ReadonlyArray<string>, infos: ReadonlyArray<PrefabInfo>, saved?: PrefabRef) {
    let savedUpdated = 0
    if (useEditor.getState().catalogIndex === null) return savedUpdated
    for (const info of infos) {
      const isSaved = saved !== undefined && isSamePrefab(info, saved)
      const updated = yield* followOne(tabIds, info, isSaved).pipe(
        Effect.catch((error) => Effect.as(Effect.logWarning(`Couldn't follow the prefab ${info.name}`, error), 0))
      )
      if (isSaved) savedUpdated = updated
    }
    return savedUpdated
  }
)

/** A map just shown in tab `tabId`: its instances catch up with what happened while it was closed. */
export const followDefinitionsIn = Effect.fn("followDefinitionsIn")(function*(tabId: string) {
  relinkRenamed(tabId)
  yield* followDefinitions([tabId], useEditor.getState().prefabs)
})
