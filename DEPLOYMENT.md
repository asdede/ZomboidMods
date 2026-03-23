# Production / deployment

## 1. Electron apps (`modmanager/`, `server/`)

These are desktop apps. **Production** usually means shipping a **built binary** (installer / AppImage / portable `.exe`) so users don’t need Node on the PATH.

### One-time setup (per app folder)

```bash
cd modmanager   # or: cd server
npm install
npm install --save-dev electron-builder
```

### Build

```bash
npm run dist
```

Outputs go to **`dist/`** (e.g. Linux **AppImage**, Windows **portable** / installer, macOS **dmg** — depends on OS and `build` config in `package.json`).

### What end users need

- Run the built executable.
- **Mod manager**: repo layout should still be the parent of `modmanager/` (or adjust paths if you repackage elsewhere).
- **Server maintainer**: user points the app at the dedicated **`Server`** folder (contains `servertest.ini` and `mods/`).

### “Minimal” production without a builder

- Zip the app folder **after** `npm install` / `npm ci` on the target OS.
- Users run **`npx electron .`** or **`./node_modules/.bin/electron .`** from that folder (still requires Node + downloaded Electron).

---

## 2. Project Zomboid mods (`mods/<mod_id>/`)

**Production** = what the **server** (and clients) load.

1. Copy the mod folder to the dedicated server’s **`Server/mods/<mod_id>/`** (or subscribe via **Steam Workshop** if you publish there).
2. Add the mod **`id`** from `mod.info` to **`Mods=`** in `servertest.ini` (or your INI name).
3. Clients need the **same mod** enabled (same Workshop item or same files).
4. Restart the server after changing `Mods=` or mod files.

There is no separate “compile” step for Lua mods unless you use a tooling pipeline; the game loads `media/lua/...` as-is.

---

## 3. CI (`.github/workflows/ci.yml`)

- Runs **`npm ci`** + **`npm run dist -- --linux dir`** in **`modmanager/`** and **`server/`** on pushes and PRs to `main` / `master`.
- See workflow file for exact triggers.

## 4. Mirror to `clientProd` & `serverProd` repos (after green build)

This is **not** the same as GitHub’s **Fork** button (forks keep one name and link to upstream). The workflow **creates two separate repositories** if they don’t exist, then **force-pushes** the same branch to both.

### When it runs

Only on **successful `push`** to **`main`** or **`master`** (not on pull request builds), and only if all three secrets below are set.

### Repository secrets (Settings → Secrets and variables → Actions)

| Secret | Example | Purpose |
|--------|---------|--------|
| `PROD_MIRROR_TOKEN` | PAT | Must allow **`repo`**, and permission to **create repos** under the owner (org: `admin:org` or org owner; user: account owner). |
| `PROD_CLIENT_REPO` | `MyOrg/clientProd` | Full name: **owner/repo** for the client prod mirror. |
| `PROD_SERVER_REPO` | `MyOrg/serverProd` | Full name for the server prod mirror. |

Create empty repos manually first if you prefer; the job skips creation when they already exist.

### Behaviour

1. **`build`** job runs (Electron builds).
2. **`mirror-prod`** runs only if `build` succeeded **and** the three secrets are non-empty.
3. **Ensures** `PROD_CLIENT_REPO` and `PROD_SERVER_REPO` exist (creates **private** empty repo via API if missing).
4. **`git push --force`** the current branch (`github.ref_name`) to both remotes.

**Personal account:** `owner` in `owner/clientProd` must match the GitHub user that owns the PAT. **Organization:** the PAT must be allowed to create repositories in that org.

---

## 5. Optional: upload CI build artifacts

- Add a step to upload **`modmanager/dist`** / **`server/dist`** as workflow artifacts or attach to Releases.
