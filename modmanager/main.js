const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

/** Normalize user input: trim, expand ~/…, resolve to absolute path. */
function resolveInstallPath(input) {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return "";
  }
  if (raw === "~" || raw.startsWith("~" + path.sep) || raw.startsWith("~/")) {
    const rest = raw === "~" ? "" : raw.slice(2);
    return path.resolve(os.homedir(), rest.replace(/^[\\/]+/, ""));
  }
  return path.resolve(raw);
}

const CONFIG_FILE_NAME = "config.json";

/**
 * Electron app lives in `modmanager/`; `mods/` and `.git` are in the parent repo root.
 * `app.getAppPath()` → …/ZomboidMods/modmanager → repo root is its parent.
 */
function getRepoRoot() {
  return path.dirname(app.getAppPath());
}

/** Folder containing package.json / main.js (the `modmanager` app directory). */
function getAppRoot() {
  return app.getAppPath();
}

function getModsRoot() {
  return path.join(getRepoRoot(), "mods");
}

function getConfigPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE_NAME);
}

async function readConfig() {
  try {
    const raw = await fs.readFile(getConfigPath(), "utf8");
    const parsed = JSON.parse(raw);
    const stored =
      typeof parsed.installPath === "string" ? parsed.installPath : "";
    return {
      installPath: stored ? resolveInstallPath(stored) : "",
    };
  } catch (error) {
    return { installPath: "" };
  }
}

async function writeConfig(config) {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), "utf8");
}

function parseModInfo(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    result[key] = value;
  }
  return {
    id: result.id || "",
    name: result.name || "",
    description: result.description || "",
    version: result.version || "",
  };
}

async function getModFolders() {
  const modsRoot = getModsRoot();
  let entries = [];
  try {
    entries = await fs.readdir(modsRoot, { withFileTypes: true });
  } catch (error) {
    return [];
  }

  const folders = entries.filter((entry) => entry.isDirectory());
  const mods = [];
  for (const folder of folders) {
    const modFolder = path.join(modsRoot, folder.name);
    const modInfoPath = path.join(modFolder, "mod.info");
    try {
      const modInfoRaw = await fs.readFile(modInfoPath, "utf8");
      const info = parseModInfo(modInfoRaw);
      mods.push({
        folderName: folder.name,
        id: info.id || folder.name,
        name: info.name || folder.name,
        description: info.description,
        version: info.version,
      });
    } catch (error) {
      // Ignore folders without mod.info to keep behavior minimal.
    }
  }

  return mods.sort((a, b) => a.name.localeCompare(b.name));
}

/** Scan configured install path: each subfolder with optional mod.info → name, version, id. */
async function getInstalledModFolders() {
  const config = await readConfig();
  const root = config.installPath;
  if (!root) {
    return { installPath: "", mods: [] };
  }
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return { installPath: root, mods: [], error: "Cannot read install path" };
  }

  const folders = entries.filter((entry) => entry.isDirectory());
  const mods = [];
  for (const folder of folders) {
    const modFolder = path.join(root, folder.name);
    const modInfoPath = path.join(modFolder, "mod.info");
    try {
      const modInfoRaw = await fs.readFile(modInfoPath, "utf8");
      const info = parseModInfo(modInfoRaw);
      mods.push({
        folderName: folder.name,
        id: info.id || folder.name,
        name: info.name || folder.name,
        description: info.description || "",
        version: info.version || "",
      });
    } catch {
      mods.push({
        folderName: folder.name,
        id: folder.name,
        name: folder.name,
        description: "",
        version: "",
        missingModInfo: true,
      });
    }
  }

  mods.sort((a, b) => a.name.localeCompare(b.name));
  return { installPath: root, mods };
}

async function ensureInstallPathExists(installPath) {
  if (!installPath || typeof installPath !== "string") {
    throw new Error("Install path is required.");
  }
  await fs.mkdir(installPath, { recursive: true });
}

/** Prevent path traversal when resolving mod folder names under install path. */
function assertSafeModFolderName(name) {
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("Invalid mod folder name.");
  }
  const base = path.basename(name);
  if (base !== name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error("Invalid mod folder name.");
  }
}

function runGitPull(cwd) {
  return new Promise((resolve, reject) => {
    execFile("git", ["pull", "--ff-only"], { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve((stdout || stderr || "Already up to date.").trim());
    });
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadFile(path.join(__dirname, "index.html"));
}

/** Register IPC before windows load so invoke() always finds handlers. */
function registerIpcHandlers() {
  ipcMain.handle("app:get-state", async () => {
    const [config, mods] = await Promise.all([readConfig(), getModFolders()]);
    return {
      config,
      mods,
      appRoot: getAppRoot(),
      repoRoot: getRepoRoot(),
      modsRoot: getModsRoot(),
    };
  });

  /** Installed copies under config install path (reads mod.info per folder). */
  ipcMain.handle("mods:getInstalled", async () => {
    const data = await getInstalledModFolders();
    return {
      ok: !data.error,
      error: data.error,
      installPath: data.installPath,
      mods: data.mods || [],
    };
  });

  ipcMain.handle("config:choose-install-path", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose install path",
    });
    if (result.canceled || !result.filePaths[0]) {
      return "";
    }
    return result.filePaths[0];
  });

  ipcMain.handle("config:set-install-path", async (_, installPath) => {
    const resolved = resolveInstallPath(installPath);
    if (!resolved) {
      throw new Error("Install path is required.");
    }
    await ensureInstallPathExists(resolved);
    await writeConfig({ installPath: resolved });
    return { installPath: resolved };
  });

  ipcMain.handle("mods:install", async (_, folderNames) => {
    const config = await readConfig();
    await ensureInstallPathExists(config.installPath);

    const installed = [];
    for (const folderName of folderNames) {
      assertSafeModFolderName(folderName);
      const source = path.join(getModsRoot(), folderName);
      const destination = path.join(config.installPath, folderName);
      await fs.rm(destination, { recursive: true, force: true });
      await fs.cp(source, destination, { recursive: true });
      installed.push(folderName);
    }

    return { installed };
  });

  /** Remove mod folders from the configured install path only (does not touch repo `mods/`). */
  ipcMain.handle("mods:uninstall", async (_, folderNames) => {
    const config = await readConfig();
    if (!config.installPath) {
      throw new Error("Install path is not set.");
    }
    await ensureInstallPathExists(config.installPath);

    const list = Array.isArray(folderNames) ? folderNames : [];
    const removed = [];
    for (const folderName of list) {
      assertSafeModFolderName(folderName);
      const target = path.join(config.installPath, folderName);
      await fs.rm(target, { recursive: true, force: true });
      removed.push(folderName);
    }
    return { removed };
  });

  ipcMain.handle("mods:check-updates", async () => {
    const repoRoot = getRepoRoot();
    const gitPath = path.join(repoRoot, ".git");
    try {
      await fs.access(gitPath);
    } catch (error) {
      return { ok: false, output: "No .git directory found. Update check skipped." };
    }

    try {
      const output = await runGitPull(repoRoot);
      const mods = await getModFolders();
      return { ok: true, output, mods };
    } catch (error) {
      return { ok: false, output: error.message };
    }
  });
}

// Register as soon as main loads — before any window or app.ready (avoids missing invoke targets).
registerIpcHandlers();

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
