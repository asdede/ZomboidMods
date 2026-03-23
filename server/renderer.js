const el = (id) => document.getElementById(id);

const statusEl = el("status");
const pathSummaryEl = el("pathSummary");
const installedBody = el("installedBody");
const modsText = el("modsText");

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", !!isError);
}

function parseModsTextToIds(text) {
  return text
    .split(/[;\n\r,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function idsToText(ids, sep) {
  const s = sep === "," ? "," : ";";
  return (ids || []).join(s);
}

let lastInstalled = [];
let lastIniMods = [];
let lastSep = ";";

function updateIniOrphanHint(installed) {
  const hint = document.getElementById("iniOrphanHint");
  if (!hint) return;
  const idsOnDisk = new Set((installed || []).map((m) => m.id));
  const missing = lastIniMods.filter((id) => !idsOnDisk.has(id));
  if (missing.length === 0) {
    hint.hidden = true;
    hint.textContent = "";
    return;
  }
  hint.hidden = false;
  hint.innerHTML =
    `<span class="text-warn">In Mods= but no matching folder in Server/mods:</span> ` +
    escapeHtml(missing.join(", "));
}

function renderInstalledTable(installed, activeIdSet) {
  installedBody.innerHTML = "";
  for (const m of installed) {
    const tr = document.createElement("tr");
    const inIni = activeIdSet.has(m.id);
    if (inIni) {
      tr.classList.add("in-ini");
    }
    const idAttr = escapeAttr(m.id);
    const folderAttr = escapeAttr(m.folderName);
    const statusHtml = inIni
      ? `<span class="muted text-green">in Mods=</span>`
      : `<span class="muted text-red">not in Mods=</span>`;
    tr.innerHTML = `
      <td><input type="checkbox" class="mod-cb" data-id="${idAttr}" ${inIni ? "checked" : ""} /></td>
      <td><input type="checkbox" class="uninstall-cb" data-folder="${folderAttr}" title="Mark folder for deletion from disk" /></td>
      <td>${escapeHtml(m.id)}</td>
      <td>${escapeHtml(m.name)}</td>
      <td>${escapeHtml(m.version || "—")}</td>
      <td>${escapeHtml(m.folderName)}${m.missingModInfo ? " *" : ""}</td>
      <td>${statusHtml}</td>
    `;
    installedBody.appendChild(tr);
  }
  installedBody.querySelectorAll(".mod-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      rebuildModsTextFromCheckboxes();
    });
  });
  updateIniOrphanHint(installed);
}

function getUninstallFolders() {
  const boxes = installedBody.querySelectorAll(".uninstall-cb:checked");
  return Array.from(boxes).map((cb) => cb.getAttribute("data-folder"));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function getCheckboxIdsInOrder() {
  const ids = [];
  const rows = installedBody.querySelectorAll("tr");
  for (const row of rows) {
    const cb = row.querySelector(".mod-cb");
    if (cb && cb.checked) {
      ids.push(cb.getAttribute("data-id"));
    }
  }
  return ids;
}

function rebuildModsTextFromCheckboxes() {
  const ids = getCheckboxIdsInOrder();
  modsText.value = idsToText(ids, lastSep);
}

function applyState(data) {
  const cfg = data.config || {};
  el("serverRoot").value = cfg.serverRoot || "";
  el("iniName").value = cfg.iniFileName || "servertest.ini";
  el("modsSep").value = cfg.modsSeparator === "," ? "," : ";";
  lastSep = el("modsSep").value;

  const p = data.paths || {};
  pathSummaryEl.textContent = [
    p.serverRoot ? `Server root: ${p.serverRoot}` : "Server root: (not set)",
    p.iniPath ? `INI: ${p.iniPath}` : "",
    p.modsDir ? `Mods dir: ${p.modsDir}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const ini = data.ini;
  const mods = data.mods;

  lastInstalled = mods && mods.ok && mods.installed ? mods.installed : [];
  lastIniMods =
    ini && ini.ok && Array.isArray(ini.modsFromIni) ? [...ini.modsFromIni] : [];

  const activeSet = new Set(lastIniMods);
  renderInstalledTable(lastInstalled, activeSet);

  if (ini && ini.ok) {
    modsText.value = idsToText(lastIniMods, lastSep);
  } else if (!modsText.value.trim() && lastInstalled.length) {
    modsText.value = "";
  }

  if (ini && !ini.ok && ini.error) {
    setStatus(`INI: ${ini.error}`, true);
  } else if (mods && !mods.ok && mods.error) {
    setStatus(`Mods folder: ${mods.error}`, true);
  } else {
    setStatus(
      `Loaded. INI mods: ${lastIniMods.length}. Installed folders: ${lastInstalled.length}.`
    );
  }
}

async function loadAll() {
  try {
    setStatus("Loading…");
    const data = await window.zomboidServerApi.loadAll();
    applyState(data);
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

el("browseRoot").addEventListener("click", async () => {
  const p = await window.zomboidServerApi.chooseServerRoot();
  if (p) el("serverRoot").value = p;
});

el("saveConfig").addEventListener("click", async () => {
  try {
    await window.zomboidServerApi.setConfig({
      serverRoot: el("serverRoot").value.trim(),
      iniFileName: el("iniName").value.trim() || "servertest.ini",
      modsSeparator: el("modsSep").value === "," ? "," : ";",
    });
    lastSep = el("modsSep").value;
    setStatus("Settings saved.");
    await loadAll();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
});

el("refreshAll").addEventListener("click", loadAll);

el("modsSep").addEventListener("change", () => {
  lastSep = el("modsSep").value;
  const ids = parseModsTextToIds(modsText.value);
  modsText.value = idsToText(ids, lastSep);
});

el("syncFromIni").addEventListener("click", () => {
  modsText.value = idsToText(lastIniMods, lastSep);
  const activeSet = new Set(lastIniMods);
  renderInstalledTable(lastInstalled, activeSet);
  setStatus("Synced textarea & checkboxes from last INI read.");
});

el("selectAllInstalled").addEventListener("click", () => {
  installedBody.querySelectorAll(".mod-cb").forEach((cb) => {
    cb.checked = true;
  });
  rebuildModsTextFromCheckboxes();
  const ids = parseModsTextToIds(modsText.value);
  const activeSet = new Set(ids);
  renderInstalledTable(lastInstalled, activeSet);
  setStatus("Selected all installed mod ids.");
});

el("clearMods").addEventListener("click", () => {
  modsText.value = "";
  installedBody.querySelectorAll(".mod-cb").forEach((cb) => {
    cb.checked = false;
  });
  renderInstalledTable(lastInstalled, new Set());
  setStatus("Cleared list (not written to disk yet).");
});

el("uninstallFolders").addEventListener("click", async () => {
  const folders = getUninstallFolders();
  if (folders.length === 0) {
    setStatus("Tick Uninstall next to at least one mod folder.", true);
    return;
  }
  const removeFromIni = el("alsoRemoveFromIni").checked;
  const ok = window.confirm(
    `Delete ${folders.length} folder(s) from Server/mods?\n\n${folders.join(", ")}\n\n` +
      (removeFromIni ? "Matching ids will be removed from Mods= in INI.\n" : "INI will not be changed.\n") +
      "\nThis cannot be undone."
  );
  if (!ok) return;
  try {
    setStatus("Uninstalling…");
    const result = await window.zomboidServerApi.uninstallMods({
      folderNames: folders,
      removeFromIni,
    });
    if (!result.ok) {
      setStatus(result.error || "Uninstall failed", true);
      return;
    }
    let msg = `Removed: ${(result.removed || []).join(", ")}.`;
    if (result.iniUpdated) {
      msg += ` INI updated (${(result.modsFromIni || []).length} mods in Mods=).`;
    }
    if (result.warning) {
      msg += " " + result.warning;
    }
    setStatus(msg);
    await loadAll();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
});

el("writeIni").addEventListener("click", async () => {
  const ids = parseModsTextToIds(modsText.value);
  try {
    setStatus("Writing INI…");
    await window.zomboidServerApi.setConfig({
      modsSeparator: el("modsSep").value === "," ? "," : ";",
    });
    const result = await window.zomboidServerApi.saveMods(ids);
    if (!result.ok) {
      setStatus(result.error || "Save failed", true);
      return;
    }
    lastIniMods = result.modsFromIni || ids;
    setStatus(`Saved Mods= (${(result.modsFromIni || ids).length} ids).`);
    await loadAll();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
});

loadAll();
