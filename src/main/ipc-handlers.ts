import { ipcMain, dialog, BrowserWindow, app, shell } from "electron";
import { statSync } from "node:fs";
import type {
  OperationResult,
  MergePrecheckRequest,
  MergeRequest,
  ExtractRequest,
  ViewRequest,
  OpenFileDialogRequest,
  SaveFileDialogRequest,
  OpenDirectoryDialogRequest,
  ListAliasesRequest,
  JksToP12Request,
  P12ToJksRequest
} from "../types";
import { mergePrecheck, mergePkcs12 } from "./services/merge-service";
import { extractPkcs12 } from "./services/extract-service";
import { viewPkcs12 } from "./services/view-service";
import { jksToP12, p12ToJks, listKeystoreAliases } from "./services/convert-service";
import { mapError } from "./services/error-mapper";
import { createLogger, getSessionId } from "./utils/logger";

const log = createLogger("ipc");

// Services already return OperationResult for expected failures. This wrapper
// catches unexpected throws and converts them via error-mapper into a shape
// the renderer can translate.
async function guard<T>(
  channel: string,
  op: () => Promise<OperationResult<T>>
): Promise<OperationResult<T>> {
  const startedAt = Date.now();
  try {
    const r = await op();
    log.info("handled", { channel, success: r.success, durationMs: Date.now() - startedAt });
    return r;
  } catch (e) {
    const err = e as Error & { code?: string };
    const raw = `${err.code ?? ""} ${err.message ?? String(e)}`;
    const mapped = mapError(raw);
    log.error("unexpected throw", { channel, mappedKey: mapped.i18nKey, durationMs: Date.now() - startedAt }, err);
    return { success: false, message: mapped.i18nKey, warnings: [] };
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle("pkcs12:merge:precheck", async (_e, params: MergePrecheckRequest) => {
    return guard("pkcs12:merge:precheck", () => mergePrecheck(params));
  });

  ipcMain.handle("pkcs12:merge", async (_e, params: MergeRequest) => {
    return guard("pkcs12:merge", () => mergePkcs12(params));
  });

  ipcMain.handle("pkcs12:extract", async (_e, params: ExtractRequest) => {
    return guard("pkcs12:extract", () => extractPkcs12(params));
  });

  ipcMain.handle("pkcs12:view", async (_e, params: ViewRequest) => {
    return guard("pkcs12:view", () => viewPkcs12(params));
  });

  ipcMain.handle("jks:toP12", async (_e, params: JksToP12Request) => {
    return guard("jks:toP12", () => jksToP12(params));
  });

  ipcMain.handle("jks:fromP12", async (_e, params: P12ToJksRequest) => {
    return guard("jks:fromP12", () => p12ToJks(params));
  });

  ipcMain.handle("jks:listAliases", async (_e, params: ListAliasesRequest) => {
    return guard("jks:listAliases", () => listKeystoreAliases(params));
  });

  ipcMain.handle("app:getSessionId", async () => {
    return getSessionId();
  });

  ipcMain.handle("app:quit", () => {
    app.quit();
  });

  ipcMain.handle("shell:revealPath", async (_e, path: string) => {
    if (!path || typeof path !== "string") return;
    try {
      const st = statSync(path);
      if (st.isDirectory()) {
        await shell.openPath(path);
      } else {
        shell.showItemInFolder(path);
      }
    } catch {
      // fallback: try showing in folder regardless
      shell.showItemInFolder(path);
    }
  });

  ipcMain.handle("dialog:openFile", async (e, params: OpenFileDialogRequest) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const properties: Array<"openFile" | "multiSelections"> = ["openFile"];
    if (params?.multiSelect) properties.push("multiSelections");
    const result = win
      ? await dialog.showOpenDialog(win, { filters: params?.filters, properties, title: params?.title })
      : await dialog.showOpenDialog({ filters: params?.filters, properties, title: params?.title });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("dialog:saveFile", async (e, params: SaveFileDialogRequest) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = { filters: params?.filters, defaultPath: params?.defaultName, title: params?.title };
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts);
    return result.canceled ? "" : (result.filePath ?? "");
  });

  ipcMain.handle("dialog:openDirectory", async (e, params: OpenDirectoryDialogRequest) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
      title: params?.title,
      defaultPath: params?.defaultPath
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    return result.canceled || result.filePaths.length === 0 ? "" : result.filePaths[0];
  });
}
