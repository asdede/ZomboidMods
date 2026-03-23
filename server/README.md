# Zomboid Server maintainer (Electron)

Small desktop UI for a **Project Zomboid dedicated `Server` folder**:

- Remembers your **`Server` directory** (the one that contains `servertest.ini` and the `mods/` folder).
- Reads **`servertest.ini`** (or another INI name you set) and parses the **`Mods=`** line.
- Scans **`Server/mods/*/mod.info`** for **`id`**, **`name`**, **`version`**.
- Lets you edit the **active mod list** and **write** it back to **`Mods=`** (comma or semicolon separator).
- **Uninstall** deletes selected folders under **`Server/mods`**, and optionally removes matching mod **ids** from **`Mods=`** in the INI (read from each folder’s `mod.info` before deletion).

## Setup

```bash
cd server
npm install
npm start
```

## First run

1. Click **Browse** and select your Zomboid dedicated **`Server`** folder  
   Example: `…/Zomboid Dedicated Server/Server`  
   That folder must contain:
   - `servertest.ini` (or change **INI filename**)
   - `mods/` (workshop/mod folders)
2. Set **Mods= separator** — `;` matches typical PZ; `,` is supported for reading and writing.
3. **Save settings**, then **Reload INI & mods**.

## Editing `Mods=`

- **Installed** table: tick mods to include; order follows table order (installed sort is by **id**).
- **Text area**: edit `mod_id` list (lines, commas, or semicolons allowed when parsing).
- **Write Mods= to INI** saves the file; other INI lines are kept as-is (only the `Mods=` line is replaced, or `[Server]` + `Mods=` is added if missing).

## Config storage

Settings are stored in Electron **userData** as `zomboid-server-maintainer-config.json` (not `.env`).

## Notes

- **WorkshopItems=** is not modified; only **`Mods=`** is managed here.
- Mod folders without `mod.info` still appear with **folder name** as id and a `*` marker.
