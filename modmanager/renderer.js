const statusElement = document.getElementById("status");
const installPathInput = document.getElementById("installPath");
const modsListElement = document.getElementById("modsList");
const modsCountElement = document.getElementById("modsCount");
const installedModsListElement = document.getElementById("installedModsList");
const installedModsCountElement = document.getElementById("installedModsCount");

let currentMods = [];

function setStatus(message) {
  statusElement.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function renderMods(mods, installedMods) {
  const installedList = installedMods && Array.isArray(installedMods.mods) ? installedMods.mods : [];
  currentMods = mods;
  modsCountElement.textContent = `${mods.length} mods found`;
  if (mods.length === 0) {
    modsListElement.innerHTML = `<div class="hint">No mods with mod.info found under mods/</div>`;
    return;
  }

  const rows = mods
    .map((mod) => {
      const name = escapeHtml(mod.name || mod.folderName);
      const version = escapeHtml(mod.version || "unknown");
      const description = escapeHtml(mod.description || "No description");
      const folderRaw = mod.folderName || "";
      const folderName = escapeHtml(folderRaw);
      const installedRow = installedList.find((m) => m.folderName === folderRaw);
      const upToDate = installedRow
        ? String(installedRow.version || "") === String(mod.version || "")
        : false;

      return `
        <div class="mod">
          <label>
            <input type="checkbox" data-folder="${escapeAttr(folderRaw)}" />
            <span class="mod-title">${name}</span>
            ${installedRow ? `<span class="muted text-green">installed</span>` : `<span class="muted text-red">not installed</span>`}
            ${installedRow ? (upToDate ? `<span class="muted text-green">up to date</span>` : `<span class="muted text-red">out of date</span>`) : ""}
          </label>
          <div class="muted">folder: ${folderName}</div>
          <div>version: ${version}</div>
          <div>${description}</div>
        </div>
      `;
    })
    .join("");
  modsListElement.innerHTML = rows;
}

function renderInstalledMods(result) {
  if (!installedModsCountElement || !installedModsListElement) {
    return;
  }
  const mods = result?.mods || [];
  const err = result?.error;
  installedModsCountElement.textContent = err
    ? `Could not read install path: ${err}`
    : `${mods.length} folder(s) in install path`;

  if (mods.length === 0) {
    installedModsListElement.innerHTML =
      '<div class="hint">No mod folders found (or install path not set / unreadable).</div>';
    return;
  }

  const rows = mods
    .map((mod) => {
      const name = escapeHtml(mod.name || mod.folderName);
      const version = escapeHtml(mod.version || "—");
      const id = escapeHtml(mod.id || mod.folderName);
      const folderName = escapeHtml(mod.folderName);
      const desc = escapeHtml(mod.description || "");
      const flag = mod.missingModInfo ? ' <span class="muted">(no mod.info)</span>' : "";
      return `
        <div class="mod">
          <span class="mod-title">${name}</span>${flag}
          <div class="muted">id: ${id} · folder: ${folderName}</div>
          <div>version: ${version}</div>
          ${desc ? `<div>${desc}</div>` : ""}
        </div>
      `;
    })
    .join("");
  installedModsListElement.innerHTML = rows;
}

function getSelectedFolders() {
  const checkboxes = modsListElement.querySelectorAll("input[type=checkbox]:checked");
  return Array.from(checkboxes).map((node) => node.getAttribute("data-folder"));
}

async function reloadState() {
  const state = await window.modManagerApi.getState();
  installPathInput.value = state.config.installPath || "";
  let installed = { ok: true, mods: [], error: null };
  try {
    installed = await window.modManagerApi.getInstalledMods();
  } catch (e) {
    installed = {
      ok: false,
      mods: [],
      error: e?.message || String(e),
    };
  }
  renderMods(state.mods || [], installed);
  renderInstalledMods(installed);
  setStatus(
    `Ready.\nRepo root: ${state.repoRoot || state.appRoot}\nApp (modmanager): ${state.appRoot}\nMods root: ${state.modsRoot}\nInstall path: ${state.config.installPath || "(not set)"}`
  );
}

document.getElementById("browsePath").addEventListener("click", async () => {
  const selected = await window.modManagerApi.chooseInstallPath();
  if (selected) {
    installPathInput.value = selected;
    setStatus(`Selected install path: ${selected}`);
  }
});

function formatError(error) {
  if (!error) {
    return "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error.message) {
    return error.message;
  }
  return String(error);
}

document.getElementById("savePath").addEventListener("click", async () => {
  try {
    const installPath = installPathInput.value.trim();
    if (!installPath) {
      setStatus("Install path is required.");
      return;
    }
    setStatus("Saving install path...");
    const result = await window.modManagerApi.setInstallPath(installPath);
    const saved = result?.installPath ?? installPath;
    installPathInput.value = saved;
    await reloadState();
    setStatus(`Saved install path: ${saved}`);
  } catch (error) {
    setStatus(`Failed to save path: ${formatError(error)}`);
  }
});

document.getElementById("refreshMods").addEventListener("click", async () => {
  try {
    setStatus("Refreshing mods...");
    await reloadState();
  } catch (error) {
    setStatus(`Refresh failed: ${error.message || String(error)}`);
  }
});

document.getElementById("checkUpdates").addEventListener("click", async () => {
  try {
    setStatus("Running git pull...");
    const result = await window.modManagerApi.checkUpdates();
    let installed = { ok: true, mods: [], error: null };
    try {
      installed = await window.modManagerApi.getInstalledMods();
    } catch (e) {
      installed = { ok: false, mods: [], error: e?.message || String(e) };
    }
    if (result.mods) {
      renderMods(result.mods, installed);
    }
    renderInstalledMods(installed);
    setStatus(result.output || (result.ok ? "Update check complete." : "Update failed."));
  } catch (error) {
    setStatus(`Update check failed: ${error.message || String(error)}`);
  }
});

document.getElementById("installSelected").addEventListener("click", async () => {
  const selectedFolders = getSelectedFolders();
  if (selectedFolders.length === 0) {
    setStatus("Select at least one mod.");
    return;
  }
  try {
    setStatus(`Installing ${selectedFolders.length} mod(s)...`);
    const result = await window.modManagerApi.installMods(selectedFolders);
    const installed = await window.modManagerApi.getInstalledMods();
    const state = await window.modManagerApi.getState();
    renderMods(state.mods || [], installed);
    renderInstalledMods(installed);
    setStatus(`Installed: ${(result.installed || []).join(", ")}`);
  } catch (error) {
    setStatus(`Install failed: ${error.message || String(error)}`);
  }
});

document.getElementById("uninstallSelected").addEventListener("click", async () => {
  const selectedFolders = getSelectedFolders();
  if (selectedFolders.length === 0) {
    setStatus("Select at least one mod to uninstall.");
    return;
  }
  const installPath = installPathInput.value.trim();
  if (!installPath) {
    setStatus("Set and save install path before uninstalling.");
    return;
  }
  const ok = window.confirm(
    `Remove these folders from the install path?\n\n${selectedFolders.join(", ")}\n\nTarget: ${installPath}\n\n(This does not delete mods in the repo.)`
  );
  if (!ok) {
    return;
  }
  try {
    setStatus(`Uninstalling ${selectedFolders.length} mod(s) from install path...`);
    const result = await window.modManagerApi.uninstallMods(selectedFolders);
    const installed = await window.modManagerApi.getInstalledMods();
    const state = await window.modManagerApi.getState();
    renderMods(state.mods || [], installed);
    renderInstalledMods(installed);
    setStatus(`Removed from install path: ${(result.removed || []).join(", ")}`);
  } catch (error) {
    setStatus(`Uninstall failed: ${formatError(error)}`);
  }
});

reloadState().catch((error) => {
  setStatus(`Startup failed: ${error.message || String(error)}`);
});
