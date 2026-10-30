import { KeyValueStore } from "effect/persistence"

/** Browser localStorage; in-memory when there is none (tests). Shared by the stores. */
export const browserStorage = typeof globalThis.localStorage === "undefined"
  ? KeyValueStore.layerMemory
  : KeyValueStore.layerStorage(() => globalThis.localStorage)
