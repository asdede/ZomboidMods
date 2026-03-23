--[[ Clan Map Markers — SERVER — faction (or manual tag) shared map symbols ]]

require "ClanMapMarkersShared"

local MOD = ClanMapMarkersShared.MOD
local MOD_DATA = ClanMapMarkersShared.MOD_DATA
local CMD_SET_MANUAL_TAG = ClanMapMarkersShared.CMD_SET_MANUAL_TAG
local CMD_PUSH_MARKERS = ClanMapMarkersShared.CMD_PUSH_MARKERS
local CMD_REQUEST_SYNC = ClanMapMarkersShared.CMD_REQUEST_SYNC
local CMD_SYNC = ClanMapMarkersShared.CMD_SYNC

local DEBUG = false

local function dprint(...)
    if not DEBUG then return end
    print("[ClanMapMarkers][SRV] " .. table.concat({ ... }, " "))
end

local eventsRegistered = false

local function safeFactionFor(player)
    if not player then return nil end
    if not Faction or not Faction.getPlayerFaction then return nil end
    local ok, fac = pcall(function()
        return Faction.getPlayerFaction(player)
    end)
    if ok then return fac end
    return nil
end

--- Stable key for grouping: faction tag/name, else manual tag from player mod data.
local function getClanKey(player)
    if not player then return nil end
    local fac = safeFactionFor(player)
    if fac then
        local tag = fac.getTag and fac:getTag() or ""
        local name = fac.getName and fac:getName() or "faction"
        if tag and tag ~= "" then
            return "F:" .. tostring(tag)
        end
        return "F:" .. tostring(name)
    end
    local md = player:getModData()
    local manual = md and md.ClanMapManualTag
    if manual and manual ~= "" then
        return "M:" .. tostring(manual)
    end
    return nil
end

local function sanitizeManualTag(tag)
    if type(tag) ~= "string" then return nil end
    local t = tag:gsub("^%s+", ""):gsub("%s+$", "")
    if #t < 2 or #t > 24 then return nil end
    if not t:match("^[%w_-]+$") then return nil end
    return t
end

local function getStore()
    return ModData.getOrCreate(MOD_DATA)
end

local function ensureClanBucket(store, clanKey)
    if not store[clanKey] then
        store[clanKey] = { markers = {}, v = 1 }
    end
    if not store[clanKey].markers then
        store[clanKey].markers = {}
    end
    return store[clanKey]
end

local function markerIdExists(markers, id)
    for _, m in ipairs(markers) do
        if m.id == id then return true end
    end
    return false
end

local function forEachOnlinePlayer(fn)
    local plist = getOnlinePlayers and getOnlinePlayers() or nil
    if plist and plist.size and plist:size() > 0 then
        for i = 0, plist:size() - 1 do
            local p = plist:get(i)
            if p then fn(p) end
        end
        return
    end
    if IsoPlayer and IsoPlayer.getPlayers then
        plist = IsoPlayer.getPlayers()
        if plist and plist.size then
            for i = 0, plist:size() - 1 do
                local p = plist:get(i)
                if p then fn(p) end
            end
        end
    end
end

local function broadcastClan(clanKey, payload)
    if not clanKey or not sendServerCommand then return end
    forEachOnlinePlayer(function(p)
        if getClanKey(p) == clanKey then
            pcall(function()
                sendServerCommand(p, MOD, CMD_SYNC, payload)
            end)
        end
    end)
end

local function mergeMarkers(clanKey, incoming, authorName)
    if not clanKey or type(incoming) ~= "table" then return false end
    local store = getStore()
    local bucket = ensureClanBucket(store, clanKey)
    local markers = bucket.markers
    local changed = false

    for _, m in ipairs(incoming) do
        if type(m) == "table" and m.x and m.y then
            local id = m.id
            if not id or id == "" then
                id = authorName .. "_" .. tostring(m.x) .. "_" .. tostring(m.y) .. "_" .. tostring(m.kind or "?")
            end
            if not markerIdExists(markers, id) then
                local entry = {
                    id = id,
                    author = authorName,
                    x = tonumber(m.x) or 0,
                    y = tonumber(m.y) or 0,
                    kind = m.kind or "texture",
                    textureId = m.textureId,
                    text = m.text,
                    font = m.font,
                    anchorX = m.anchorX,
                    anchorY = m.anchorY,
                    scale = m.scale,
                    r = m.r,
                    g = m.g,
                    b = m.b,
                    a = m.a,
                }
                table.insert(markers, entry)
                changed = true
            end
        end
    end

    if changed then
        bucket.v = (bucket.v or 1) + 1
        ModData.transmit(MOD_DATA)
        broadcastClan(clanKey, { markers = markers, clanKey = clanKey })
    end
    return changed
end

local function onClientCommand(module, command, player, args)
    if module ~= MOD or not player then return end

    local uname = player:getUsername() or "?"

    if command == CMD_SET_MANUAL_TAG then
        local tag = sanitizeManualTag(args and args.tag)
        if not tag then
            dprint("bad manual tag from", uname)
            return
        end
        player:getModData().ClanMapManualTag = tag
        dprint("manual tag set", uname, tag)
        -- Send current clan markers to this player
        local ck = getClanKey(player)
        if ck then
            local store = getStore()
            local bucket = store[ck]
            if bucket and bucket.markers and sendServerCommand then
                pcall(function()
                    sendServerCommand(player, MOD, CMD_SYNC, { markers = bucket.markers, clanKey = ck })
                end)
            end
        end
        return
    end

    if command == CMD_REQUEST_SYNC then
        local ck = getClanKey(player)
        if not ck then return end
        local store = getStore()
        local bucket = store[ck]
        if bucket and bucket.markers and sendServerCommand then
            pcall(function()
                sendServerCommand(player, MOD, CMD_SYNC, { markers = bucket.markers, clanKey = ck })
            end)
        end
        return
    end

    if command == CMD_PUSH_MARKERS then
        local ck = getClanKey(player)
        if not ck then
            dprint("pushMarkers: no clan key", uname)
            return
        end
        local list = args and args.markers
        if type(list) ~= "table" then return end
        mergeMarkers(ck, list, uname)
        return
    end
end

local function register()
    if eventsRegistered then return end
    if Events and Events.OnClientCommand then
        Events.OnClientCommand.Add(onClientCommand)
        eventsRegistered = true
        dprint("OnClientCommand registered")
    else
        print("[ClanMapMarkers][SRV] ERROR: Events.OnClientCommand missing")
    end
end

if Events and Events.OnServerStarted then
    Events.OnServerStarted.Add(register)
end
if Events and Events.OnGameBoot then
    Events.OnGameBoot.Add(register)
end
register()

print("[ClanMapMarkers][SRV] loaded")
