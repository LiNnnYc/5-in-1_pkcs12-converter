import { describe, it, expect, beforeEach, vi } from "vitest";

// Smoke tests for the Day 10 IPC wiring:
// - `guard` wrapper catches unexpected throws and maps them to i18n keys
// - pkcs12:* channels delegate to the right service
// - dialog:* channels forward to Electron dialog
//
// These intentionally do NOT spin up an Electron window; we stub ipcMain +
// dialog and inspect the registered handlers directly.

type Handler = (e: unknown, payload: unknown) => unknown;

const hoisted = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  dialogMock: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  }
}));
const handlers = hoisted.handlers;
const dialogMock = hoisted.dialogMock;

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => hoisted.handlers.set(channel, fn)
  },
  dialog: hoisted.dialogMock,
  BrowserWindow: { fromWebContents: () => null }
}));

const merge = vi.hoisted(() => ({
  mergePrecheck: vi.fn(),
  mergePkcs12: vi.fn()
}));
const extract = vi.hoisted(() => ({ extractPkcs12: vi.fn() }));
const view = vi.hoisted(() => ({ viewPkcs12: vi.fn() }));
const convert = vi.hoisted(() => ({
  jksToP12: vi.fn(),
  p12ToJks: vi.fn(),
  listKeystoreAliases: vi.fn()
}));

vi.mock("../../src/main/services/merge-service", () => merge);
vi.mock("../../src/main/services/extract-service", () => extract);
vi.mock("../../src/main/services/view-service", () => view);
vi.mock("../../src/main/services/convert-service", () => convert);

import { registerIpcHandlers } from "../../src/main/ipc-handlers";

beforeEach(() => {
  handlers.clear();
  merge.mergePrecheck.mockReset();
  merge.mergePkcs12.mockReset();
  extract.extractPkcs12.mockReset();
  view.viewPkcs12.mockReset();
  convert.jksToP12.mockReset();
  convert.p12ToJks.mockReset();
  convert.listKeystoreAliases.mockReset();
  dialogMock.showOpenDialog.mockReset();
  dialogMock.showSaveDialog.mockReset();
  registerIpcHandlers();
});

describe("IPC registration", () => {
  it("registers all M1 + M2 channels", () => {
    expect([...handlers.keys()].sort()).toEqual([
      "app:getRuntimeInfo",
      "app:getSessionId",
      "app:quit",
      "dialog:openDirectory",
      "dialog:openFile",
      "dialog:saveFile",
      "engines:getInfo",
      "jks:fromP12",
      "jks:listAliases",
      "jks:toP12",
      "pkcs12:detectInputType",
      "pkcs12:extract",
      "pkcs12:merge",
      "pkcs12:merge:precheck",
      "pkcs12:view",
      "pkcs12:viewKey",
      "settings:get",
      "settings:set",
      "shell:openExternal",
      "shell:revealPath",
      "shell:revealWorkDir"
    ]);
  });
});

describe("pkcs12:* delegation and guard wrapper", () => {
  it("merge:precheck passes params and returns service result", async () => {
    merge.mergePrecheck.mockResolvedValue({ success: true, message: "ok" });
    const params = { privateKeyFile: "/k", serverCertFile: "/c", chainCertFiles: [] };
    const r = await handlers.get("pkcs12:merge:precheck")!({}, params);
    expect(merge.mergePrecheck).toHaveBeenCalledWith(params);
    expect(r).toEqual({ success: true, message: "ok" });
  });

  it("merge routes to mergePkcs12", async () => {
    merge.mergePkcs12.mockResolvedValue({ success: true, message: "ok", outputFiles: ["/o.pfx"] });
    const r = await handlers.get("pkcs12:merge")!({}, { outputFile: "/o.pfx" });
    expect(merge.mergePkcs12).toHaveBeenCalled();
    expect((r as { outputFiles: string[] }).outputFiles).toEqual(["/o.pfx"]);
  });

  it("extract routes to extractPkcs12", async () => {
    extract.extractPkcs12.mockResolvedValue({ success: true, message: "ok" });
    await handlers.get("pkcs12:extract")!({}, { pfxFile: "/x" });
    expect(extract.extractPkcs12).toHaveBeenCalledWith({ pfxFile: "/x" });
  });

  it("view routes to viewPkcs12", async () => {
    view.viewPkcs12.mockResolvedValue({ success: true, message: "ok" });
    await handlers.get("pkcs12:view")!({}, { pfxFile: "/x", pfxPassword: "p" });
    expect(view.viewPkcs12).toHaveBeenCalled();
  });

  it("unexpected ENOENT throw -> error.fileNotFound", async () => {
    const err = Object.assign(new Error("no such file or directory"), { code: "ENOENT" });
    merge.mergePrecheck.mockRejectedValue(err);
    const r = await handlers.get("pkcs12:merge:precheck")!({}, {}) as { success: boolean; message: string };
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.fileNotFound");
  });

  it("unexpected EACCES throw -> error.outputNotWritable", async () => {
    const err = Object.assign(new Error("permission denied"), { code: "EACCES" });
    extract.extractPkcs12.mockRejectedValue(err);
    const r = await handlers.get("pkcs12:extract")!({}, {}) as { success: boolean; message: string };
    expect(r.message).toBe("error.outputNotWritable");
  });

  it("unexpected generic throw -> error.unknown", async () => {
    view.viewPkcs12.mockRejectedValue(new Error("boom"));
    const r = await handlers.get("pkcs12:view")!({}, {}) as { success: boolean; message: string };
    expect(r.message).toBe("error.unknown");
  });
});

describe("jks:* delegation", () => {
  it("jks:toP12 routes to convert-service.jksToP12", async () => {
    convert.jksToP12.mockResolvedValue({ success: true, message: "ok", outputFiles: ["/o.p12"] });
    const params = { jksFile: "/x.jks", jksPassword: "p", outputFile: "/o.p12", outputPassword: "q" };
    const r = await handlers.get("jks:toP12")!({}, params);
    expect(convert.jksToP12).toHaveBeenCalledWith(params);
    expect((r as { success: boolean }).success).toBe(true);
  });

  it("jks:fromP12 routes to convert-service.p12ToJks", async () => {
    convert.p12ToJks.mockResolvedValue({ success: true, message: "ok" });
    const params = { pfxFile: "/x.p12", pfxPassword: "p", outputFile: "/o.jks", outputPassword: "q" };
    await handlers.get("jks:fromP12")!({}, params);
    expect(convert.p12ToJks).toHaveBeenCalledWith(params);
  });

  it("jks:listAliases routes to convert-service.listKeystoreAliases", async () => {
    convert.listKeystoreAliases.mockResolvedValue({ success: true, message: "ok", details: { aliases: ["a"] } });
    const params = { keystoreFile: "/x.jks", keystorePassword: "p", storeType: "JKS" };
    await handlers.get("jks:listAliases")!({}, params);
    expect(convert.listKeystoreAliases).toHaveBeenCalledWith(params);
  });

  it("jks:toP12 unexpected throw -> error.unknown via guard", async () => {
    convert.jksToP12.mockRejectedValue(new Error("keytool blew up"));
    const r = await handlers.get("jks:toP12")!({}, {}) as { success: boolean; message: string };
    expect(r.success).toBe(false);
    expect(r.message).toBe("error.unknown");
  });
});

describe("dialog:* channels", () => {
  it("openFile returns filePaths when not canceled", async () => {
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/a", "/b"] });
    const r = await handlers.get("dialog:openFile")!({ sender: {} }, { multiSelect: true });
    expect(r).toEqual(["/a", "/b"]);
    expect(dialogMock.showOpenDialog).toHaveBeenCalled();
    const arg = dialogMock.showOpenDialog.mock.calls[0][0];
    expect(arg.properties).toContain("multiSelections");
  });

  it("openFile returns [] when canceled", async () => {
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const r = await handlers.get("dialog:openFile")!({ sender: {} }, {});
    expect(r).toEqual([]);
  });

  it("saveFile returns filePath when not canceled", async () => {
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/out.pfx" });
    const r = await handlers.get("dialog:saveFile")!({ sender: {} }, { defaultName: "out.pfx" });
    expect(r).toBe("/out.pfx");
  });

  it("saveFile returns '' when canceled", async () => {
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: true });
    const r = await handlers.get("dialog:saveFile")!({ sender: {} }, {});
    expect(r).toBe("");
  });
});
