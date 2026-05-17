import { contextBridge, ipcRenderer } from "electron";

type OperationResult = {
  success: boolean;
  message: string;
  details?: unknown;
  warnings?: unknown[];
  requiresConfirmation?: boolean;
  outputFiles?: string[];
};

type OpenDialogOptions = {
  filters?: Array<{ name: string; extensions: string[] }>;
  multiSelect?: boolean;
};

type SaveDialogOptions = {
  filters?: Array<{ name: string; extensions: string[] }>;
  defaultName?: string;
};

type OpenDirectoryOptions = {
  title?: string;
  defaultPath?: string;
};

export type ElectronAPI = {
  mergePkcs12Precheck: (params: unknown) => Promise<OperationResult>;
  mergePkcs12: (params: unknown) => Promise<OperationResult>;
  extractPkcs12: (params: unknown) => Promise<OperationResult>;
  viewPkcs12: (params: unknown) => Promise<OperationResult>;
  viewKey: (params: unknown) => Promise<OperationResult>;
  detectInputType: (filePath: string) => Promise<{ kind: "pfx" | "keyUnencrypted" | "keyEncrypted" | "unknown"; reason?: string }>;
  jksToP12: (params: unknown) => Promise<OperationResult>;
  p12ToJks: (params: unknown) => Promise<OperationResult>;
  listKeystoreAliases: (params: unknown) => Promise<OperationResult>;
  openFileDialog: (params: OpenDialogOptions) => Promise<string[]>;
  saveFileDialog: (params: SaveDialogOptions) => Promise<string>;
  openDirectoryDialog: (params: OpenDirectoryOptions) => Promise<string>;
  getSessionId: () => Promise<string>;
  quitApp: () => Promise<void>;
  revealPath: (path: string) => Promise<void>;
  revealWorkDir: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  getSettings: () => Promise<AppSettings>;
  setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  getEngineInfo: () => Promise<EngineInfo>;
  getRuntimeInfo: () => Promise<RuntimeInfo>;
};

export type AppSettings = {
  logging: { enabled: boolean; level: "debug" | "info" | "warn" | "error" };
  locale: "zh-TW" | "en" | "ja";
};

export type EngineInfo = {
  openssl: { path: string; version: string };
  keytool: { path: string; version: string };
  enginesDir: string;
};

export type RuntimeInfo = {
  version: string;
  sessionId: string;
  loggingEnabled: boolean;
  currentLogFile: string | null;
  logsDir: string;
  workDir: string;
};

const electronAPI: ElectronAPI = {
  mergePkcs12Precheck: (params) => ipcRenderer.invoke("pkcs12:merge:precheck", params),
  mergePkcs12: (params) => ipcRenderer.invoke("pkcs12:merge", params),
  extractPkcs12: (params) => ipcRenderer.invoke("pkcs12:extract", params),
  viewPkcs12: (params) => ipcRenderer.invoke("pkcs12:view", params),
  viewKey: (params) => ipcRenderer.invoke("pkcs12:viewKey", params),
  detectInputType: (filePath) => ipcRenderer.invoke("pkcs12:detectInputType", filePath),
  jksToP12: (params) => ipcRenderer.invoke("jks:toP12", params),
  p12ToJks: (params) => ipcRenderer.invoke("jks:fromP12", params),
  listKeystoreAliases: (params) => ipcRenderer.invoke("jks:listAliases", params),
  openFileDialog: (params) => ipcRenderer.invoke("dialog:openFile", params),
  saveFileDialog: (params) => ipcRenderer.invoke("dialog:saveFile", params),
  openDirectoryDialog: (params) => ipcRenderer.invoke("dialog:openDirectory", params),
  getSessionId: () => ipcRenderer.invoke("app:getSessionId"),
  quitApp: () => ipcRenderer.invoke("app:quit"),
  revealPath: (path) => ipcRenderer.invoke("shell:revealPath", path),
  revealWorkDir: () => ipcRenderer.invoke("shell:revealWorkDir"),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  getEngineInfo: () => ipcRenderer.invoke("engines:getInfo"),
  getRuntimeInfo: () => ipcRenderer.invoke("app:getRuntimeInfo")
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

