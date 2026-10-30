import { app } from "electron"

// The Electron main process. The window, the ballest:// protocol and the IPC handlers arrive with the shell
// (docs/DESKTOP.md § Main process); until then the app starts and quits.
void app.whenReady().then(() => app.quit())
