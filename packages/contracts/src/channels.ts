// The IPC channel of each `DesktopBridge` member, by member name. `DesktopMethods` and `DesktopPushes` in
// DesktopBridge.ts hold the schemas, under the same names (typecheck fails when the two tables differ). The channels
// are kept apart because the preload bundles this file: a sandboxed preload has to be one self-contained script, and
// the schemas would bring effect (~300 kB) into it. No imports here.

/** Renderer → main (`ipcRenderer.invoke` → `ipcMain.handle`): one channel per method in `DesktopMethods`. */
export const InvokeChannels = {
  ping: "ballest:ping",
  projectState: "ballest:project:state",
  chooseProject: "ballest:project:choose",
  checkProject: "ballest:project:check",
  openProjectWindow: "ballest:project:openWindow",
  switchProject: "ballest:project:switch",
  createProject: "ballest:project:create",
  revealProject: "ballest:project:reveal",
  renameProject: "ballest:project:rename",
  rememberOpenMap: "ballest:project:rememberOpenMap",
  listMaps: "ballest:project:listMaps",
  readMap: "ballest:project:readMap",
  createMap: "ballest:project:createMap",
  saveMap: "ballest:project:saveMap",
  renameMap: "ballest:project:renameMap",
  writeSidecar: "ballest:project:writeSidecar",
  pickImport: "ballest:project:pickImport",
  importMap: "ballest:project:importMap",
  exportMap: "ballest:project:exportMap",
  checkExports: "ballest:project:checkExports",
  reimportMap: "ballest:project:reimportMap",
  listBackups: "ballest:project:listBackups",
  readBackup: "ballest:project:readBackup",
  listPrefabs: "ballest:prefabs:list",
  readPrefab: "ballest:prefabs:read",
  writePrefab: "ballest:prefabs:write",
  deletePrefab: "ballest:prefabs:delete",
  renamePrefab: "ballest:prefabs:rename",
  revealPrefabs: "ballest:prefabs:reveal",
  listPrefabBackups: "ballest:prefabs:listBackups",
  describePrefabBackup: "ballest:prefabs:describeBackup",
  restorePrefabBackup: "ballest:prefabs:restoreBackup",
  setWindowTheme: "ballest:window:setTheme",
  confirmUnsaved: "ballest:window:confirmUnsaved",
  openExternal: "ballest:shell:openExternal",
  gamePaths: "ballest:game:paths",
  chooseGamePath: "ballest:game:choosePath",
  resetGamePath: "ballest:game:resetPath",
  revealGamePath: "ballest:game:revealPath",
  launchGame: "ballest:game:launch",
  isGameRunning: "ballest:game:isRunning",
  findCreator: "ballest:game:findCreator",
  pluginStatus: "ballest:game:pluginStatus",
  installPlugin: "ballest:game:installPlugin",
  play: "ballest:game:play",
  loadNotifications: "ballest:notifications:load",
  saveNotifications: "ballest:notifications:save",
  muteNotifications: "ballest:notifications:mute",
  gameLinkMemory: "ballest:gameLink:memory",
  rememberGameLink: "ballest:gameLink:remember",
  getUpdateState: "ballest:update:get",
  checkForUpdates: "ballest:update:check",
  downloadUpdate: "ballest:update:download",
  installUpdate: "ballest:update:install"
} as const

/** Main → renderer (`webContents.send`): one channel per subscription in `DesktopPushes`. */
export const PushChannels = {
  onUnloadRequest: "ballest:window:unloadRequest",
  onPlaySessionEnded: "ballest:game:playSessionEnded",
  onUpdateState: "ballest:update:state"
} as const
