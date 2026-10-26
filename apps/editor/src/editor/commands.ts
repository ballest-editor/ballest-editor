/**
 * UI commands that keybinds can trigger but that live in React components (dialogs, file
 * picker).
 *
 * TODO(menu-bar): a universal menu bar (File / Edit / View / ...) should call these same
 * commands, e.g. Edit > Settings… -> openDialog("settings"), File > Import… -> openImport().
 */
export type SettingsCategory = "general" | "camera" | "keybinds" | "appearance"
export type Dialog = "new" | "settings"

export const commands = {
  openDialog: (_dialog: Dialog, _category?: SettingsCategory): void => {},
  openImport: (): void => {},
  /** True while a modal dialog is open; editor keybinds are suspended. */
  dialogOpen: (): boolean => false
}
