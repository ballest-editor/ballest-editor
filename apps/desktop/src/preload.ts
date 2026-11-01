import type { DesktopBridge, PlaySessionEnded, UnloadKind, UpdateState } from "@ballest/contracts"
import { contextBridge, ipcRenderer } from "electron"
import {
  CHECK_EXPORTS_CHANNEL,
  CHOOSE_GAME_PATH_CHANNEL,
  CHOOSE_PROJECT_CHANNEL,
  CONFIRM_UNSAVED_CHANNEL,
  CREATE_MAP_CHANNEL,
  DOWNLOAD_UPDATE_CHANNEL,
  EXPORT_MAP_CHANNEL,
  FIND_CREATOR_CHANNEL,
  GAME_LINK_MEMORY_CHANNEL,
  GAME_PATHS_CHANNEL,
  GET_UPDATE_STATE_CHANNEL,
  IMPORT_MAP_CHANNEL,
  INSTALL_PLUGIN_CHANNEL,
  INSTALL_UPDATE_CHANNEL,
  IS_GAME_RUNNING_CHANNEL,
  LAUNCH_GAME_CHANNEL,
  LIST_BACKUPS_CHANNEL,
  LIST_MAPS_CHANNEL,
  LOAD_NOTIFICATIONS_CHANNEL,
  MUTE_NOTIFICATIONS_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  PICK_IMPORT_CHANNEL,
  PING_CHANNEL,
  PLAY_CHANNEL,
  PLAY_SESSION_ENDED_CHANNEL,
  PLUGIN_STATUS_CHANNEL,
  PROJECT_STATE_CHANNEL,
  READ_BACKUP_CHANNEL,
  READ_MAP_CHANNEL,
  REIMPORT_MAP_CHANNEL,
  REMEMBER_GAME_LINK_CHANNEL,
  RENAME_MAP_CHANNEL,
  RESET_GAME_PATH_CHANNEL,
  REVEAL_GAME_PATH_CHANNEL,
  REVEAL_PROJECT_CHANNEL,
  SAVE_MAP_CHANNEL,
  SAVE_NOTIFICATIONS_CHANNEL,
  SET_WINDOW_THEME_CHANNEL,
  SWITCH_PROJECT_CHANNEL,
  UNLOAD_REQUEST_CHANNEL,
  UPDATE_STATE_CHANNEL
} from "./ipc/channels"

/** What main pushes on each channel it sends on (`webContents.send`). */
interface Pushed {
  readonly [UPDATE_STATE_CHANNEL]: UpdateState
  readonly [UNLOAD_REQUEST_CHANNEL]: UnloadKind
  readonly [PLAY_SESSION_ENDED_CHANNEL]: PlaySessionEnded
}

/**
 * Calls `listener` with each message main sends on `channel` (the payload, not the IPC event, which holds the sender)
 * until the returned function is called.
 */
const subscribe = <C extends keyof Pushed>(channel: C, listener: (payload: Pushed[C]) => void) => {
  const forward = (_event: unknown, payload: Pushed[C]) => listener(payload)
  ipcRenderer.on(channel, forward)
  return () => void ipcRenderer.removeListener(channel, forward)
}

// Runs sandboxed before any page script, so it is bundled self-contained: it may only require `electron`.
// Main validates every payload; this only forwards. scripts/verifyPreloadBundle.ts checks the bundle.
contextBridge.exposeInMainWorld(
  "ballest",
  {
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    ping: (message) => ipcRenderer.invoke(PING_CHANNEL, { message }),
    projectState: () => ipcRenderer.invoke(PROJECT_STATE_CHANNEL),
    chooseProject: () => ipcRenderer.invoke(CHOOSE_PROJECT_CHANNEL),
    switchProject: (path) => ipcRenderer.invoke(SWITCH_PROJECT_CHANNEL, { path }),
    revealProject: () => ipcRenderer.invoke(REVEAL_PROJECT_CHANNEL),
    listMaps: () => ipcRenderer.invoke(LIST_MAPS_CHANNEL),
    readMap: (fileName) => ipcRenderer.invoke(READ_MAP_CHANNEL, { fileName }),
    createMap: (payload) => ipcRenderer.invoke(CREATE_MAP_CHANNEL, payload),
    saveMap: (payload) => ipcRenderer.invoke(SAVE_MAP_CHANNEL, payload),
    renameMap: (payload) => ipcRenderer.invoke(RENAME_MAP_CHANNEL, payload),
    pickImport: () => ipcRenderer.invoke(PICK_IMPORT_CHANNEL),
    importMap: (payload) => ipcRenderer.invoke(IMPORT_MAP_CHANNEL, payload),
    exportMap: (payload) => ipcRenderer.invoke(EXPORT_MAP_CHANNEL, payload),
    checkExports: () => ipcRenderer.invoke(CHECK_EXPORTS_CHANNEL),
    reimportMap: (fileName) => ipcRenderer.invoke(REIMPORT_MAP_CHANNEL, { fileName }),
    listBackups: () => ipcRenderer.invoke(LIST_BACKUPS_CHANNEL),
    readBackup: (ref) => ipcRenderer.invoke(READ_BACKUP_CHANNEL, ref),
    setWindowTheme: (dark) => ipcRenderer.invoke(SET_WINDOW_THEME_CHANNEL, { dark }),
    confirmUnsaved: (prompt) => ipcRenderer.invoke(CONFIRM_UNSAVED_CHANNEL, prompt),
    onUnloadRequest: (listener) => subscribe(UNLOAD_REQUEST_CHANNEL, listener),
    openExternal: (url) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, { url }),
    gamePaths: () => ipcRenderer.invoke(GAME_PATHS_CHANNEL),
    chooseGamePath: (which) => ipcRenderer.invoke(CHOOSE_GAME_PATH_CHANNEL, { which }),
    resetGamePath: (which) => ipcRenderer.invoke(RESET_GAME_PATH_CHANNEL, { which }),
    revealGamePath: (which) => ipcRenderer.invoke(REVEAL_GAME_PATH_CHANNEL, { which }),
    launchGame: () => ipcRenderer.invoke(LAUNCH_GAME_CHANNEL),
    isGameRunning: () => ipcRenderer.invoke(IS_GAME_RUNNING_CHANNEL),
    findCreator: () => ipcRenderer.invoke(FIND_CREATOR_CHANNEL),
    pluginStatus: () => ipcRenderer.invoke(PLUGIN_STATUS_CHANNEL),
    installPlugin: () => ipcRenderer.invoke(INSTALL_PLUGIN_CHANNEL),
    play: (payload) => ipcRenderer.invoke(PLAY_CHANNEL, payload),
    onPlaySessionEnded: (listener) => subscribe(PLAY_SESSION_ENDED_CHANNEL, listener),
    loadNotifications: () => ipcRenderer.invoke(LOAD_NOTIFICATIONS_CHANNEL),
    saveNotifications: (records) => ipcRenderer.invoke(SAVE_NOTIFICATIONS_CHANNEL, { records }),
    muteNotifications: (kind) => ipcRenderer.invoke(MUTE_NOTIFICATIONS_CHANNEL, { kind }),
    gameLinkMemory: () => ipcRenderer.invoke(GAME_LINK_MEMORY_CHANNEL),
    rememberGameLink: (result) => ipcRenderer.invoke(REMEMBER_GAME_LINK_CHANNEL, result),
    getUpdateState: () => ipcRenderer.invoke(GET_UPDATE_STATE_CHANNEL),
    downloadUpdate: () => ipcRenderer.invoke(DOWNLOAD_UPDATE_CHANNEL),
    installUpdate: () => ipcRenderer.invoke(INSTALL_UPDATE_CHANNEL),
    onUpdateState: (listener) => subscribe(UPDATE_STATE_CHANNEL, listener)
  } satisfies DesktopBridge
)
