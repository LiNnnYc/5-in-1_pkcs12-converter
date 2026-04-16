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

export type ElectronAPI = {
  mergePkcs12Precheck: (params: unknown) => Promise<OperationResult>;
  mergePkcs12: (params: unknown) => Promise<OperationResult>;
  extractPkcs12: (params: unknown) => Promise<OperationResult>;
  viewPkcs12: (params: unknown) => Promise<OperationResult>;
  openFileDialog: (params: OpenDialogOptions) => Promise<string[]>;
  saveFileDialog: (params: SaveDialogOptions) => Promise<string>;
};

const electronAPI: ElectronAPI = {
  mergePkcs12Precheck: (params) => ipcRenderer.invoke("pkcs12:merge:precheck", params),
  mergePkcs12: (params) => ipcRenderer.invoke("pkcs12:merge", params),
  extractPkcs12: (params) => ipcRenderer.invoke("pkcs12:extract", params),
  viewPkcs12: (params) => ipcRenderer.invoke("pkcs12:view", params),
  openFileDialog: (params) => ipcRenderer.invoke("dialog:openFile", params),
  saveFileDialog: (params) => ipcRenderer.invoke("dialog:saveFile", params)
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

