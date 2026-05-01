import type {
  AliasEntry,
  MergePrecheckRequest,
  MergeRequest,
  ExtractRequest,
  ViewRequest,
  OpenFileDialogRequest,
  SaveFileDialogRequest,
  OpenDirectoryDialogRequest,
  ListAliasesRequest,
  JksToP12Request,
  P12ToJksRequest,
  OperationResult,
  MergePrecheckResult,
  Pkcs12ViewResult
} from "../types";

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

declare global {
  interface Window {
    electronAPI: {
      mergePkcs12Precheck: (params: MergePrecheckRequest) => Promise<OperationResult<MergePrecheckResult>>;
      mergePkcs12: (params: MergeRequest) => Promise<OperationResult>;
      extractPkcs12: (params: ExtractRequest) => Promise<OperationResult>;
      viewPkcs12: (params: ViewRequest) => Promise<OperationResult<Pkcs12ViewResult>>;
      jksToP12: (params: JksToP12Request) => Promise<OperationResult>;
      p12ToJks: (params: P12ToJksRequest) => Promise<OperationResult>;
      listKeystoreAliases: (params: ListAliasesRequest) => Promise<OperationResult<{ aliases: AliasEntry[] }>>;
      openFileDialog: (params: OpenFileDialogRequest) => Promise<string[]>;
      saveFileDialog: (params: SaveFileDialogRequest) => Promise<string>;
      openDirectoryDialog: (params: OpenDirectoryDialogRequest) => Promise<string>;
      getSessionId: () => Promise<string>;
      quitApp: () => Promise<void>;
      revealPath: (path: string) => Promise<void>;
      revealWorkDir: () => Promise<void>;
      getSettings: () => Promise<AppSettings>;
      setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
      getEngineInfo: () => Promise<EngineInfo>;
      getRuntimeInfo: () => Promise<RuntimeInfo>;
    };
  }
}

export {};
