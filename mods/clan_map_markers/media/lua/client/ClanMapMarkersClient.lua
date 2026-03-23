--[[ Clan Map Markers — CLIENT — read local map symbols, push to server; apply clan sync ]]

require "ClanMapMarkersShared"

local MOD = ClanMapMarkersShared.MOD
local CMD_SET_MANUAL_TAG = ClanMapMarkersShared.CMD_SET_MANUAL_TAG
local CMD_PUSH_MARKERS = ClanMapMarkersShared.CMD_PUSH_MARKERS
local CMD_REQUEST_SYNC = ClanMapMarkersShared.CMD_REQUEST_SYNC
local CMD_SYNC = ClanMapMarkersShared.CMD_SYNC

local DEBUG = false

local function dprint(...)
    if not DEBUG then return end
    print("[ClanMapMarkers][CL] " .. table.concat({ ... }, " "))
end

--- Keys we applied from server (position-based) — do not re-upload these.
local remoteKeys = {}

--- Server marker ids we already drew (avoid duplicates on re-sync).
local appliedRemoteIds = {}

--- Markers received before world map symbols exist (apply when map is ready).
local pendingRemote = {}

--- Last serialized hash of *local* symbols we pushed (avoid spam).
local lastPushHash = ""
local PUSH_INTERVAL_FRAMES = 90
local frame = 0

local function symbolKey(x, y, kind, extra)
    return string.format(
        "%.3f|%.3f|%s|%s",
        tonumber(x) or 0,
        tonumber(y) or 0,
        tostring(kind or "?"),
        tostring(extra or "")
    )
end

pcall(require, "ISUI/Maps/ISWorldMap")

local function getWorldMapInstance()
    if ISWorldMap and ISWorldMap.instance then
        return ISWorldMap.instance
    end
    return nil
end

local function getSymbolsObject()
    local wm = getWorldMapInstance()
    if not wm or not wm.getSymbols then return nil end
    local ok, syms = pcall(function()
        return wm:getSymbols()
    end)
    if ok then return syms end
    return nil
end

--- Best-effort serialize WorldMapSymbols into plain tables.
local function serializeSymbols(symbols)
    local out = {}
    if not symbols or not symbols.getSymbolCount then return out end
    local n = 0
    pcall(function()
        n = symbols:getSymbolCount()
    end)
    for i = 0, (n or 0) - 1 do
        local sym = nil
        pcall(function()
            sym = symbols:getSymbolByIndex(i)
        end)
        if sym then
            local x, y = 0, 0
            pcall(function()
                if sym.getWorldX then
                    x = sym:getWorldX()
                    y = sym:getWorldY()
                elseif sym.getX then
                    x = sym:getX()
                    y = sym:getY()
                end
            end)

            local entry = { x = x, y = y, kind = "texture" }

            local isText = false
            local textVal = nil
            pcall(function()
                if sym.getText then
                    textVal = sym:getText()
                    if textVal and textVal ~= "" then
                        entry.kind = "text"
                        entry.text = textVal
                        isText = true
                    end
                end
            end)

            if isText and entry.text and entry.text:sub(1, 6) == "[Clan]" then
                -- Our own remote echo — don't push back.
            else
                local texId = nil
                if not isText then
                    pcall(function()
                        if sym.getTextureID then
                            texId = sym:getTextureID()
                        elseif sym.getSymbolID then
                            texId = sym:getSymbolID()
                        end
                    end)
                    entry.textureId = texId
                    entry.kind = "texture"
                end

                pcall(function()
                    if sym.getRGBA then
                        local r, g, b, a = sym:getRGBA()
                        entry.r, entry.g, entry.b, entry.a = r, g, b, a
                    end
                end)

                pcall(function()
                    if sym.getScale then entry.scale = sym:getScale() end
                end)

                local k = symbolKey(x, y, entry.kind, entry.text or entry.textureId or "")
                if not remoteKeys[k] then
                    entry.id = k
                    table.insert(out, entry)
                end
            end
        end
    end
    return out
end

local function hashMarkers(list)
    local s = ""
    for _, m in ipairs(list) do
        s = s .. (m.id or "") .. ":" .. tostring(m.x) .. ":" .. tostring(m.y) .. ";"
    end
    return s
end

local function pushIfNeeded()
    local p = getPlayer()
    if not p or not sendClientCommand then return end

    local symbols = getSymbolsObject()
    if not symbols then return end

    local list = serializeSymbols(symbols)
    local h = hashMarkers(list)
    if h == lastPushHash then return end

    sendClientCommand(p, MOD, CMD_PUSH_MARKERS, { markers = list })
    lastPushHash = h
    dprint("pushed markers", #list)
end

local function flushPendingRemote()
    if #pendingRemote == 0 then return end
    if not getSymbolsObject() then return end
    local copy = pendingRemote
    pendingRemote = {}
    for _, m in ipairs(copy) do
        applyMarkerToMap(m)
    end
end

local function onPlayerUpdate(player)
    if not player or player ~= getPlayer() then return end
    flushPendingRemote()
    frame = frame + 1
    if frame % PUSH_INTERVAL_FRAMES ~= 0 then return end
    pushIfNeeded()
end

local function applyMarkerToMap(m)
    if type(m) ~= "table" then return end
    local mid = m.id
    if mid and appliedRemoteIds[mid] then return end

    local symbols = getSymbolsObject()
    if not symbols then
        if #pendingRemote < 200 then
            table.insert(pendingRemote, m)
        end
        return
    end

    local k = symbolKey(m.x, m.y, m.kind, m.text or m.textureId or "")
    remoteKeys[k] = true
    if mid then
        appliedRemoteIds[mid] = true
    end

    if m.kind == "text" and m.text then
        local font = UIFont and UIFont.Medium or nil
        pcall(function()
            symbols:addUntranslatedText(
                "[Clan] " .. tostring(m.author or "?") .. ": " .. tostring(m.text),
                font,
                m.x,
                m.y,
                m.r or 0.3,
                m.g or 0.85,
                m.b or 1,
                m.a or 1
            )
        end)
        pcall(function()
            symbols:invalidateLayout()
        end)
        return
    end

    local tex = m.textureId
    if not tex or tex == "" then
        tex = "Arrow"
    end
    local okAdd = pcall(function()
        symbols:addTexture(tex, m.x, m.y, m.r or 1, m.g or 0.2, m.b or 0.2, m.a or 0.9)
    end)
    if not okAdd then
        local font = UIFont and UIFont.Medium or nil
        pcall(function()
            symbols:addUntranslatedText(
                "[Clan] " .. tostring(m.author or "?") .. " @ " .. tostring(tex),
                font,
                m.x,
                m.y,
                m.r or 1,
                m.g or 0.85,
                m.b or 0.2,
                m.a or 1
            )
        end)
    end
    pcall(function()
        symbols:invalidateLayout()
    end)
end

local function onServerCommand(module, command, args)
    if module ~= MOD or command ~= CMD_SYNC then return end
    if not args or type(args.markers) ~= "table" then return end

    for _, m in ipairs(args.markers) do
        applyMarkerToMap(m)
    end
end

local function requestSync()
    local p = getPlayer()
    if p and sendClientCommand then
        sendClientCommand(p, MOD, CMD_REQUEST_SYNC, {})
    end
end

local function onGameStart()
    local n = 0
    local ev
    ev = function()
        n = n + 1
        if n > 200 then
            if Events and Events.OnTick then
                Events.OnTick.Remove(ev)
            end
            requestSync()
            return
        end
        if getWorldMapInstance() then
            if Events and Events.OnTick then
                Events.OnTick.Remove(ev)
            end
            requestSync()
        end
    end
    if Events and Events.OnTick then
        Events.OnTick.Add(ev)
    else
        requestSync()
    end
end

local function setManualTag(tag)
    local p = getPlayer()
    if p and sendClientCommand then
        sendClientCommand(p, MOD, CMD_SET_MANUAL_TAG, { tag = tag })
    end
end

ClanMapMarkersClient = ClanMapMarkersClient or {}
ClanMapMarkersClient.requestSync = requestSync
ClanMapMarkersClient.setManualTag = setManualTag

Events.OnServerCommand.Add(onServerCommand)
Events.OnPlayerUpdate.Add(onPlayerUpdate)
if Events.OnGameStart then
    Events.OnGameStart.Add(onGameStart)
end

print("[ClanMapMarkers][CL] loaded")
