import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type Settings,
  type KizamiApi,
  type TimerSnapshot,
  type UpdateStatus
} from '../shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: KizamiApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.timerGetSnapshot),
  toggle: () => ipcRenderer.invoke(IPC.timerToggle),
  skip: () => ipcRenderer.invoke(IPC.timerSkip),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  hideWindow: () => ipcRenderer.invoke(IPC.windowHide),
  onSnapshot: (callback) => subscribe<TimerSnapshot>(IPC.timerSnapshot, callback),
  onSettingsChanged: (callback) => subscribe<Settings>(IPC.settingsChanged, callback),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.updateGetStatus),
  checkForUpdate: () => ipcRenderer.invoke(IPC.updateCheck),
  setUpdateAutoCheck: (enabled) => ipcRenderer.invoke(IPC.updateSetAutoCheck, enabled),
  skipUpdateVersion: (version) => ipcRenderer.invoke(IPC.updateSkip, version),
  openReleasePage: (url) => ipcRenderer.invoke(IPC.shellOpenExternal, url),
  onUpdateChanged: (callback) => subscribe<UpdateStatus>(IPC.updateChanged, callback),
  aboutInfo: () => ipcRenderer.invoke(IPC.aboutInfo),
  openAboutUrl: (url) => ipcRenderer.invoke(IPC.aboutOpenUrl, url)
}

contextBridge.exposeInMainWorld('kizami', api)
