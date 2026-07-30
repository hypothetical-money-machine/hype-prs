import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
} from "electron";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertGitHubWebUrl,
  getViewerWithToken,
  loadInboxWithToken,
  loadPullDiffWithToken,
  pollDeviceFlow,
  refreshUserToken,
  startDeviceFlow,
  submitReviewWithToken,
  tokenSetNeedsRefresh,
  validateRepositoryCoordinates,
  validateReviewInput,
} from "../shared/github-api.mjs";
import { needsAttentionNow } from "../shared/pr-attention.mjs";

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      allowServiceWorkers: false,
      bypassCSP: false,
      corsEnabled: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
    scheme: "hype",
  },
]);

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererDirectory = app.isPackaged
  ? path.join(app.getAppPath(), "dist-electron", "renderer")
  : path.join(moduleDirectory, "..", "dist-electron", "renderer");
const preloadPath = path.join(moduleDirectory, "preload.cjs");
const credentialPath = () =>
  path.join(app.getPath("userData"), "github-session.bin");

let panel = null;
let tray = null;
let quitting = false;
let githubAppClientId = "";
let pendingDeviceFlow = null;
let cachedInbox = null;
let cachedSession = null;
let refreshPromise = null;
let authGeneration = 0;
let authAbortController = new AbortController();

app.setName("Hype PRs");
if (process.platform === "darwin") app.dock?.hide();

app.whenReady().then(async () => {
  githubAppClientId = await readPublicClientId();
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  await registerRendererProtocol();
  createPanel();
  createTray();
  registerIpc();

  app.on("activate", () => {
    if (!panel) createPanel();
    showPanel();
  });
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

function createPanel() {
  panel = new BrowserWindow({
    backgroundColor: "#0a0c0c",
    height: 760,
    minHeight: 650,
    minWidth: 980,
    show: false,
    title: "Hype PRs",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 13 },
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
      spellcheck: true,
      webSecurity: true,
    },
    width: 1280,
  });

  panel.setAlwaysOnTop(false);
  panel.setMenuBarVisibility(false);

  panel.on("blur", () => {
    if (app.isPackaged && !quitting) panel?.hide();
  });
  panel.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    panel?.hide();
  });
  panel.on("closed", () => {
    panel = null;
  });

  panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  panel.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  panel.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  const developmentUrl = process.env.HYPE_PRS_WEB_URL?.trim();
  if (
    !app.isPackaged &&
    developmentUrl &&
    isAllowedDevelopmentUrl(developmentUrl)
  ) {
    void panel.loadURL(developmentUrl);
  } else {
    void panel.loadURL("hype://app/index.html");
  }

  panel.once("ready-to-show", () => {
    if (process.env.HYPE_SHOW_ON_START !== "0") showPanel();
  });
}

function createTray() {
  let icon = nativeImage.createFromNamedImage("NSImageNameActionTemplate");
  if (icon.isEmpty()) {
    icon = nativeImage.createFromNamedImage("NSImageNameStatusAvailable");
  }
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Hype PRs");
  tray.on("click", () => {
    if (panel?.isVisible()) panel.hide();
    else showPanel();
  });
  tray.on("right-click", () => {
    tray?.popUpContextMenu(buildTrayMenu());
  });
  updateTrayBadge();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      click: showPanel,
      label: panel?.isVisible() ? "Focus Hype PRs" : "Show Hype PRs",
    },
    {
      click: () => void refreshFromTray(),
      enabled: Boolean(githubAppClientId),
      label: "Refresh",
    },
    { type: "separator" },
    {
      click: () => void disconnectGitHub(),
      enabled: Boolean(cachedInbox),
      label: "Disconnect GitHub",
    },
    { type: "separator" },
    {
      click: () => {
        quitting = true;
        app.quit();
      },
      label: "Quit Hype PRs",
      role: "quit",
    },
  ]);
}

function showPanel() {
  if (!panel) return;
  positionPanel();
  panel.show();
  panel.focus();
}

function positionPanel() {
  if (!panel || !tray) return;
  const trayBounds = tray.getBounds();
  const panelBounds = panel.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  });
  const workArea = display.workArea;
  const desiredX = Math.round(
    trayBounds.x + trayBounds.width / 2 - panelBounds.width / 2,
  );
  const x = Math.max(
    workArea.x,
    Math.min(desiredX, workArea.x + workArea.width - panelBounds.width),
  );
  const y = Math.max(
    workArea.y,
    Math.min(
      Math.round(trayBounds.y + trayBounds.height + 4),
      workArea.y + workArea.height - panelBounds.height,
    ),
  );
  panel.setPosition(x, y, false);
}

async function registerRendererProtocol() {
  protocol.handle("hype", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "app") return new Response("Not found", { status: 404 });
      const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const relativePath = pathname || "index.html";
      const filePath = path.resolve(rendererDirectory, relativePath);
      const relative = path.relative(rendererDirectory, filePath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return new Response("Forbidden", { status: 403 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function registerIpc() {
  ipcMain.handle("hype:connection-status", withTrustedSender(async () => {
    const operation = currentAuthOperation();
    const session = await readEncryptedSession(operation.generation);
    assertCurrentAuthOperation(operation);
    return {
      authKind: githubAppClientId ? "device" : null,
      configured: Boolean(githubAppClientId),
      connected: Boolean(session),
      expiresAt: session?.tokenSet?.expiresAt ?? null,
      mode: "electron",
      viewer: session?.viewer ?? null,
    };
  }));

  ipcMain.handle("hype:start-device-flow", withTrustedSender(async () => {
    const operation = currentAuthOperation();
    const flow = await startDeviceFlow(
      githubAppClientId,
      operation.signal,
    );
    assertCurrentAuthOperation(operation);
    pendingDeviceFlow = {
      authGeneration: operation.generation,
      deviceCode: flow.deviceCode,
      expiresAt: Date.now() + flow.expiresIn * 1000,
      interval: flow.interval,
      lastPolledAt: 0,
    };
    return {
      expiresIn: flow.expiresIn,
      interval: flow.interval,
      userCode: flow.userCode,
      verificationUri: flow.verificationUri,
    };
  }));

  ipcMain.handle("hype:poll-device-flow", withTrustedSender(async () => {
    if (
      !pendingDeviceFlow ||
      pendingDeviceFlow.authGeneration !== authGeneration ||
      Date.now() >= pendingDeviceFlow.expiresAt
    ) {
      pendingDeviceFlow = null;
      return {
        message: "The GitHub device code expired. Start again.",
        status: "expired",
      };
    }
    const activeFlow = pendingDeviceFlow;
    const minimumDelay = activeFlow.interval * 1000;
    if (Date.now() - activeFlow.lastPolledAt < minimumDelay) {
      return { status: "pending" };
    }
    activeFlow.lastPolledAt = Date.now();
    const operation = currentAuthOperation();
    const result = await pollDeviceFlow(
      githubAppClientId,
      activeFlow.deviceCode,
      operation.signal,
    );
    assertCurrentAuthOperation(operation);
    if (
      pendingDeviceFlow !== activeFlow ||
      activeFlow.authGeneration !== authGeneration
    ) {
      throw new Error("GitHub connection was cancelled.");
    }
    if (result.status !== "token") {
      if (result.status === "slow_down") activeFlow.interval += 5;
      return result;
    }
    const viewer = await getViewerWithToken(
      result.tokenSet.accessToken,
      operation.signal,
    );
    assertCurrentAuthOperation(operation);
    if (
      pendingDeviceFlow !== activeFlow ||
      activeFlow.authGeneration !== authGeneration
    ) {
      throw new Error("GitHub connection was cancelled.");
    }
    await writeEncryptedSession(
      { tokenSet: result.tokenSet, viewer },
      activeFlow.authGeneration,
    );
    if (pendingDeviceFlow === activeFlow) pendingDeviceFlow = null;
    cachedInbox = null;
    return {
      expiresAt: result.tokenSet.expiresAt,
      status: "connected",
      viewer,
    };
  }));

  ipcMain.handle("hype:disconnect", withTrustedSender(disconnectGitHub));

  ipcMain.handle("hype:get-inbox", withTrustedSender(async () => {
    const operation = currentAuthOperation();
    const token = await validAccessToken(operation);
    const previousCount = countActionable(cachedInbox?.pullRequests ?? []);
    const inbox = await loadInboxWithToken(token, operation.signal);
    assertCurrentAuthOperation(operation);
    cachedInbox = inbox;
    updateTrayBadge();
    const nextCount = countActionable(cachedInbox.pullRequests);
    if (
      previousCount > 0 &&
      nextCount > previousCount &&
      Notification.isSupported()
    ) {
      new Notification({
        body: `${nextCount} pull requests need your attention.`,
        silent: true,
        title: "Hype PRs",
      }).show();
    }
    return cachedInbox;
  }));

  ipcMain.handle("hype:get-pull-diff", withTrustedSender(async (_event, input) => {
    if (!input || typeof input !== "object") {
      throw new Error("Invalid pull request.");
    }
    validateRepositoryCoordinates(input);
    const operation = currentAuthOperation();
    const token = await validAccessToken(operation);
    const diff = await loadPullDiffWithToken(token, input, operation.signal);
    assertCurrentAuthOperation(operation);
    return diff;
  }));

  ipcMain.handle("hype:submit-review", withTrustedSender(async (_event, input) => {
    validateReviewInput(input);
    const operation = currentAuthOperation();
    const result = await submitReviewWithToken(
      await validAccessToken(operation),
      input,
      operation.signal,
    );
    assertCurrentAuthOperation(operation);
    cachedInbox = null;
    updateTrayBadge();
    return result;
  }));

  ipcMain.handle("hype:open-external", withTrustedSender(async (_event, value) => {
    const url = assertGitHubWebUrl(value);
    await shell.openExternal(url.toString());
  }));
}

function withTrustedSender(handler) {
  return async (event, ...args) => {
    if (
      !panel ||
      event.sender !== panel.webContents ||
      event.senderFrame !== panel.webContents.mainFrame ||
      !isTrustedRendererUrl(event.senderFrame?.url ?? "")
    ) {
      throw new Error("Blocked an untrusted renderer request.");
    }
    try {
      return await handler(event, ...args);
    } catch (error) {
      throw new Error(safeErrorMessage(error));
    }
  };
}

async function validAccessToken(operation = currentAuthOperation()) {
  assertCurrentAuthOperation(operation);
  const sessionData = await readEncryptedSession(operation.generation);
  assertCurrentAuthOperation(operation);
  if (!sessionData?.tokenSet?.accessToken) {
    throw new Error("Connect an approved GitHub App to continue.");
  }
  if (!tokenSetNeedsRefresh(sessionData.tokenSet)) {
    assertCurrentAuthOperation(operation);
    return sessionData.tokenSet.accessToken;
  }
  if (!sessionData.tokenSet.refreshToken) {
    await disconnectGitHub();
    throw new Error("The GitHub session expired. Connect again.");
  }

  if (!refreshPromise) {
    const refreshOperation = currentAuthOperation();
    const refreshTask = (async () => {
      const tokenSet = await refreshUserToken({
        clientId: githubAppClientId,
        refreshToken: sessionData.tokenSet.refreshToken,
      }, refreshOperation.signal);
      assertCurrentAuthOperation(refreshOperation);
      await writeEncryptedSession(
        { tokenSet, viewer: sessionData.viewer },
        refreshOperation.generation,
      );
      assertCurrentAuthOperation(refreshOperation);
      return tokenSet.accessToken;
    })();
    const trackedRefresh = refreshTask.finally(() => {
      if (refreshPromise === trackedRefresh) refreshPromise = null;
    });
    refreshPromise = trackedRefresh;
  }
  const accessToken = await refreshPromise;
  assertCurrentAuthOperation(operation);
  return accessToken;
}

async function readEncryptedSession(expectedGeneration = authGeneration) {
  if (cachedSession && expectedGeneration === authGeneration) {
    return cachedSession;
  }
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const encoded = await readFile(credentialPath(), "utf8");
    assertAuthGeneration(expectedGeneration);
    const encrypted = Buffer.from(encoded, "base64");
    const asyncAvailable =
      typeof safeStorage.isAsyncEncryptionAvailable === "function" &&
      (await safeStorage.isAsyncEncryptionAvailable());
    const asyncResult = asyncAvailable
      ? await safeStorage.decryptStringAsync(encrypted)
      : null;
    const decrypted = asyncResult
      ? asyncResult.result
      : safeStorage.decryptString(encrypted);
    assertAuthGeneration(expectedGeneration);
    const sessionData = JSON.parse(decrypted);
    if (!sessionData?.tokenSet?.accessToken) return null;
    if (asyncResult?.shouldReEncrypt) {
      await writeEncryptedSession(sessionData, expectedGeneration);
    }
    assertAuthGeneration(expectedGeneration);
    cachedSession = sessionData;
    return sessionData;
  } catch (error) {
    if (error?.code === "AUTH_CANCELLED") throw error;
    return null;
  }
}

async function writeEncryptedSession(session, expectedGeneration = authGeneration) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "macOS Keychain encryption is unavailable. GitHub was not connected.",
    );
  }
  const serialized = JSON.stringify(session);
  const asyncAvailable =
    typeof safeStorage.isAsyncEncryptionAvailable === "function" &&
    (await safeStorage.isAsyncEncryptionAvailable());
  const encrypted =
    asyncAvailable
      ? await safeStorage.encryptStringAsync(serialized)
      : safeStorage.encryptString(serialized);
  const destination = credentialPath();
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(destination), { mode: 0o700, recursive: true });
  try {
    await writeFile(temporary, encrypted.toString("base64"), {
      encoding: "utf8",
      mode: 0o600,
    });
    if (expectedGeneration !== authGeneration) {
      throw new Error("GitHub connection was cancelled.");
    }
    await rename(temporary, destination);
    if (expectedGeneration !== authGeneration) {
      await unlink(destination).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      throw new Error("GitHub connection was cancelled.");
    }
    cachedSession = session;
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function disconnectGitHub() {
  authGeneration += 1;
  authAbortController.abort();
  authAbortController = new AbortController();
  refreshPromise = null;
  pendingDeviceFlow = null;
  cachedInbox = null;
  cachedSession = null;
  try {
    await unlink(credentialPath());
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  updateTrayBadge();
}

async function refreshFromTray() {
  try {
    const operation = currentAuthOperation();
    const token = await validAccessToken(operation);
    const inbox = await loadInboxWithToken(token, operation.signal);
    assertCurrentAuthOperation(operation);
    cachedInbox = inbox;
    updateTrayBadge();
    panel?.webContents.send("hype:inbox-updated");
  } catch {
    cachedInbox = null;
    updateTrayBadge();
  }
}

function currentAuthOperation() {
  return {
    generation: authGeneration,
    signal: authAbortController.signal,
  };
}

function assertCurrentAuthOperation(operation) {
  if (
    operation.signal.aborted ||
    operation.generation !== authGeneration
  ) {
    throw authCancelledError();
  }
}

function assertAuthGeneration(expectedGeneration) {
  if (expectedGeneration !== authGeneration) {
    throw authCancelledError();
  }
}

function authCancelledError() {
  const error = new Error("GitHub connection was cancelled.");
  error.code = "AUTH_CANCELLED";
  return error;
}

function updateTrayBadge() {
  const count = countActionable(cachedInbox?.pullRequests ?? []);
  tray?.setTitle(count > 0 ? String(count) : "");
  tray?.setToolTip(
    count > 0
      ? `Hype PRs — ${count} need attention`
      : "Hype PRs — nothing needs attention",
  );
}

function countActionable(pullRequests) {
  const now = new Date();
  return pullRequests.filter((pullRequest) =>
    needsAttentionNow(pullRequest, now),
  ).length;
}

async function readPublicClientId() {
  const environmentClientId =
    process.env.HYPE_GITHUB_APP_CLIENT_ID?.trim() ?? "";
  if (environmentClientId) return environmentClientId;

  const configPath = app.isPackaged
    ? path.join(process.resourcesPath, "config", "github.json")
    : path.join(moduleDirectory, "config", "github.json");
  try {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    return typeof config.githubAppClientId === "string"
      ? config.githubAppClientId.trim()
      : "";
  } catch {
    return "";
  }
}

function isTrustedRendererUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "hype:" && url.hostname === "app") return true;
    return !app.isPackaged && isAllowedDevelopmentUrl(value);
  } catch {
    return false;
  }
}

function isAllowedDevelopmentUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.port === "3000"
    );
  } catch {
    return false;
  }
}

function safeErrorMessage(error) {
  if (!(error instanceof Error)) return "The operation failed.";
  return error.message
    .replaceAll(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 500);
}
