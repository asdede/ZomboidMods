const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const CONFIG_FILE = "zomboid-server-maintainer-config.json";

function getConfigPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE);
}

async function readConfig() {
  try {
    const raw = await fs.readFile(getConfigPath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      /** Absolute path to the Zomboid `Server` folder (contains servertest.ini and mods/) */
      serverRoot: typeof parsed.serverRoot === "string" ? parsed.serverRoot : "",
      /** e.g. servertest.ini */
      iniFileName:
        typeof parsed.iniFileName === "string" && parsed.iniFileName.trim()
          ? parsed.iniFileName.trim()
          : "servertest.ini",
      /** Separator when writing Mods= line — ";" matches typical PZ, "," also supported */
      modsSeparator:
        parsed.modsSeparator === "," || parsed.modsSeparator === ";" ? parsed.modsSeparator : ";",
    };
  } catch {
    return { serverRoot: "", iniFileName: "servertest.ini", modsSeparator: ";" };
  }
}

async function writeConfig(config) {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const current = await readConfig();
  const next = {
    ...current,
    ...config,
  };
  await fs.writeFile(getConfigPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function getIniPath(cfg) {
  if (!cfg.serverRoot) return "";
  return path.join(cfg.serverRoot, cfg.iniFileName || "servertest.ini");
}

function getModsDir(cfg) {
  if (!cfg.serverRoot) return "";
  return path.join(cfg.serverRoot, "mods");
}

/** Mods shipped inside the app (resources/mods when packaged; repo `mods/` in dev). */
function getBundledModsPath() {
  return path.join(path.dirname(app.getAppPath()), "mods");
}

/** Split Mods= value into id list (comma or semicolon) */
function parseModsValue(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split(/[;,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Join mod ids for Mods= line */
function joinModsValue(ids, separator) {
  const sep = separator === "," ? "," : ";";
  return (ids || []).map((s) => String(s).trim()).filter(Boolean).join(sep);
}

/** Parse mod.info key=value lines */
function parseModInfo(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    result[key] = val;
  }
  return {
    id: result.id || "",
    name: result.name || "",
    version: result.version || "",
  };
}

/**
 * Find Mods= line (case-insensitive key). Returns { lineIndex, valueRaw } or null.
 */
function findModsLine(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s*(Mods)\s*=\s*(.*)$/i.exec(line);
    if (m) {
      return { lineIndex: i, key: m[1], valueRaw: m[2] ?? "" };
    }
  }
  return null;
}

/**
 * Replace or append Mods= in ini content lines. Preserves other lines.
 */
function setModsInLines(lines, modIds, separator) {
  const newValue = joinModsValue(modIds, separator);
  const newLine = `Mods=${newValue}`;
  const copy = [...lines];
  const found = findModsLine(copy);

  if (found) {
    copy[found.lineIndex] = newLine;
    return copy;
  }

  for (let i = 0; i < copy.length; i++) {
    if (/^\s*\[Server\]\s*$/i.test(copy[i])) {
      copy.splice(i + 1, 0, newLine);
      return copy;
    }
  }
  copy.push("[Server]", newLine);
  return copy;
}

async function readIniFile(iniPath) {
  const raw = await fs.readFile(iniPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const modsLine = findModsLine(lines);
  const modsFromIni = modsLine ? parseModsValue(modsLine.valueRaw) : [];
  return {
    exists: true,
    lines,
    raw,
    modsLineIndex: modsLine ? modsLine.lineIndex : -1,
    modsFromIni,
    modsValueRaw: modsLine ? modsLine.valueRaw : "",
  };
}

function assertSafeModFolderName(name) {
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("Invalid mod folder name.");
  }
  const base = path.basename(name);
  if (base !== name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error("Invalid mod folder name.");
  }
}

async function getModIdFromFolder(modsDir, folderName) {
  const modInfoPath = path.join(modsDir, folderName, "mod.info");
  try {
    const txt = await fs.readFile(modInfoPath, "utf8");
    const info = parseModInfo(txt);
    return info.id || folderName;
  } catch {
    return folderName;
  }
}

async function scanInstalledMods(modsDir) {
  let entries = [];
  try {
    entries = await fs.readdir(modsDir, { withFileTypes: true });
  } catch (err) {
    return {
      ok: false,
      modsDir,
      installed: [],
      error: err.message || "Cannot read mods folder",
    };
  }

  const dirs = entries.filter((e) => e.isDirectory());
  const installed = [];
  for (const d of dirs) {
    const folderName = d.name;
    const modInfoPath = path.join(modsDir, folderName, "mod.info");
    try {
      const txt = await fs.readFile(modInfoPath, "utf8");
      const info = parseModInfo(txt);
      installed.push({
        folderName,
        id: info.id || folderName,
        name: info.name || folderName,
        version: info.version || "",
      });
    } catch {
      installed.push({
        folderName,
        id: folderName,
        name: folderName,
        version: "",
        missingModInfo: true,
      });
    }
  }
  installed.sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, modsDir, installed };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 980,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "index.html"));
}

ipcMain.handle("config:get", async () => {
  const cfg = await readConfig();
  const iniPath = getIniPath(cfg);
  const modsDir = getModsDir(cfg);
  let iniExists = false;
  if (iniPath) {
    try {
      await fs.access(iniPath);
      iniExists = true;
    } catch {
      iniExists = false;
    }
  }
  return {
    config: cfg,
    paths: {
      serverRoot: cfg.serverRoot,
      iniPath,
      modsDir,
      iniExists,
      bundledModsPath: getBundledModsPath(),
    },
  };
});

ipcMain.handle("config:choose-server-root", async () => {
  const r = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select Zomboid Server folder (contains servertest.ini and mods)",
  });
  if (r.canceled || !r.filePaths[0]) return "";
  return r.filePaths[0];
});

ipcMain.handle("config:set", async (_, partial) => {
  return writeConfig(partial || {});
});

ipcMain.handle("ini:read", async () => {
  const cfg = await readConfig();
  const iniPath = getIniPath(cfg);
  if (!iniPath || !cfg.serverRoot) {
    return { ok: false, error: "Server root not set." };
  }
  try {
    await fs.access(iniPath);
  } catch {
    return { ok: false, error: `INI not found: ${iniPath}` };
  }
  const data = await readIniFile(iniPath);
  return { ok: true, ...data, iniPath };
});

ipcMain.handle("mods:scan", async () => {
  const cfg = await readConfig();
  const modsDir = getModsDir(cfg);
  if (!modsDir || !cfg.serverRoot) {
    return { ok: false, error: "Server root not set." };
  }
  const result = await scanInstalledMods(modsDir);
  return { ok: true, ...result };
});

/**
 * Delete folders under Server/mods. Optionally remove matching ids from Mods= in INI.
 * payload: { folderNames: string[], removeFromIni?: boolean }
 */
ipcMain.handle("mods:uninstall", async (_, payload) => {
  const cfg = await readConfig();
  const modsDir = getModsDir(cfg);
  if (!modsDir || !cfg.serverRoot) {
    return { ok: false, error: "Server root not set." };
  }

  const folderNames = Array.isArray(payload?.folderNames) ? payload.folderNames : [];
  const removeFromIni = payload?.removeFromIni === true;
  if (folderNames.length === 0) {
    return { ok: false, error: "No folders selected." };
  }

  const idsToStrip = new Set();
  for (const folderName of folderNames) {
    assertSafeModFolderName(folderName);
    const id = await getModIdFromFolder(modsDir, folderName);
    idsToStrip.add(id);
    idsToStrip.add(folderName);
  }

  const removed = [];
  for (const folderName of folderNames) {
    const target = path.join(modsDir, folderName);
    await fs.rm(target, { recursive: true, force: true });
    removed.push(folderName);
  }

  let modsFromIni = null;
  let iniUpdated = false;
  let warning = null;
  if (removeFromIni) {
    const iniPath = getIniPath(cfg);
    try {
      await fs.access(iniPath);
    } catch {
      warning = "INI not found; folders removed only.";
      return { ok: true, removed, iniUpdated: false, modsFromIni: null, warning };
    }
    const data = await readIniFile(iniPath);
    const sep = cfg.modsSeparator || ";";
    const nextIds = data.modsFromIni.filter((id) => !idsToStrip.has(id));
    const newLines = setModsInLines(data.lines, nextIds, sep);
    await fs.writeFile(iniPath, newLines.join("\n"), "utf8");
    const after = await readIniFile(iniPath);
    modsFromIni = after.modsFromIni;
    iniUpdated = true;
  }

  return { ok: true, removed, iniUpdated, modsFromIni, warning };
});

ipcMain.handle("ini:save-mods", async (_, modIds) => {
  const cfg = await readConfig();
  const iniPath = getIniPath(cfg);
  if (!iniPath || !cfg.serverRoot) {
    return { ok: false, error: "Server root not set." };
  }
  const list = Array.isArray(modIds) ? modIds : [];
  let lines;
  try {
    const raw = await fs.readFile(iniPath, "utf8");
    lines = raw.split(/\r?\n/);
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
  const sep = cfg.modsSeparator || ";";
  const newLines = setModsInLines(lines, list, sep);
  const newRaw = newLines.join("\n");
  await fs.writeFile(iniPath, newRaw, "utf8");
  const data = await readIniFile(iniPath);
  return { ok: true, iniPath, modsFromIni: data.modsFromIni };
});

ipcMain.handle("state:load-all", async () => {
  const cfg = await readConfig();
  const iniPath = getIniPath(cfg);
  const modsDir = getModsDir(cfg);
  let iniResult = { ok: false, error: "Server root not set" };
  if (iniPath && cfg.serverRoot) {
    try {
      await fs.access(iniPath);
      const data = await readIniFile(iniPath);
      iniResult = { ok: true, ...data, iniPath };
    } catch (e) {
      iniResult = { ok: false, error: e.message || String(e), iniPath };
    }
  }
  let modsResult = { ok: false, installed: [], modsDir: modsDir || "" };
  if (modsDir && cfg.serverRoot) {
    modsResult = await scanInstalledMods(modsDir);
  }
  return {
    config: cfg,
    paths: {
      serverRoot: cfg.serverRoot,
      iniPath,
      modsDir,
      bundledModsPath: getBundledModsPath(),
    },
    ini: iniResult,
    mods: modsResult,
  };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
