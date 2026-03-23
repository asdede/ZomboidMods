--[[ XPRecovery — SERVER — snapshot on death, client applies XP after respawn (MP-safe sync) ]]

local MOD = "XPRecovery"
local MOD_KEY = "XPRecovery"
local CMD_SNAPSHOT = "saveSnapshot"
local CMD_RESTORE_DONE = "restoreXpDone"

local DEBUG = true
local RESTORE_DELAY_TICKS = 40

local eventsRegistered = false
local pendingRecovery = {}
local restoreScheduledTick = {}
local restoreAttempted = {}
local tickCounter = 0

local function dprint(...)
    if not DEBUG then return end
    print("[XPRecovery][SRV] " .. table.concat({ ... }, " "))
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

local function tableIsEmpty(t)
    for _ in pairs(t) do
        return false
    end
    return true
end

--- Apply recipes on server only (no client UI dependency).
local function applyRecipes(player, saved)
    for _, recipe in ipairs(saved.recipes or {}) do
        if type(recipe) == "string" and recipe ~= "" and not player:isRecipeKnown(recipe) then
            player:learnRecipe(recipe)
        end
    end
end

--- Fallback when sendServerCommand is unavailable (e.g. some SP edge cases): grant XP on server object.
local function applyXpOnServerPlayer(player, xpTable)
    local xpObj = player:getXp()
    for k, xp in pairs(xpTable or {}) do
        if type(xp) == "number" and xp > 0 then
            local idx = tonumber(k)
            if idx then
                local perk = Perks.fromIndex(idx)
                if perk then
                    pcall(function()
                        xpObj:AddXP(perk, xp, false, false, true)
                    end)
                end
            end
        end
    end
    if xpObj.recalcSumm then
        pcall(function() xpObj:recalcSumm() end)
    end
end

--- Ask the owning client to AddXP locally so MP UI and sync match normal XP gain.
local function sendRestoreToClient(player, xpTable)
    if sendServerCommand then
        local ok, err = pcall(function()
            sendServerCommand(player, MOD, "restoreXp", { xp = xpTable })
        end)
        if ok then
            dprint("sendServerCommand restoreXp OK", player:getUsername())
            return true
        end
        dprint("sendServerCommand restoreXp FAILED", tostring(err))
    end
    return false
end

local function finishRecovery(player, id, data)
    local md = player:getModData()
    md.XPRecovered = true
    if data and data[id] then
        data[id] = nil
        ModData.transmit(MOD_KEY)
    end
    pendingRecovery[id] = nil
    restoreScheduledTick[id] = nil
    restoreAttempted[id] = nil
    dprint("recovery finished", id)
end

local function applyRestore(player)
    local id = player:getUsername()
    if not id or id == "" then return end
    if not pendingRecovery[id] then return end
    if restoreAttempted[id] then return end

    local md = player:getModData()
    if md.XPRecovered then
        pendingRecovery[id] = nil
        restoreScheduledTick[id] = nil
        restoreAttempted[id] = nil
        return
    end

    local data = ModData.getOrCreate(MOD_KEY)
    local saved = data[id]
    if not saved or not saved.xp then
        pendingRecovery[id] = nil
        restoreScheduledTick[id] = nil
        return
    end

    dprint("applyRestore", id)
    restoreAttempted[id] = true

    applyRecipes(player, saved)

    local xpTable = saved.xp
    if sendRestoreToClient(player, xpTable) then
        -- Client will send restoreXpDone after applying; do not mark XPRecovered here.
        return
    end

    dprint("no sendServerCommand — applying XP on server only", id)
    applyXpOnServerPlayer(player, xpTable)
    if player.Say then
        player:Say("I remember fragments of my past life...")
    end
    finishRecovery(player, id, data)
    dprint("applyRestore DONE (server-only)", id)
end

local function onTick()
    tickCounter = tickCounter + 1
    if tableIsEmpty(pendingRecovery) then return end

    forEachOnlinePlayer(function(player)
        if not player then return end

        local dead = false
        local okDead = pcall(function() dead = player:isDead() end)
        if not okDead or dead then return end

        local id = player:getUsername()
        if not id or not pendingRecovery[id] then return end

        local md = player:getModData()
        if not md or md.XPRecovered then return end

        if restoreAttempted[id] then return end

        if not restoreScheduledTick[id] then
            restoreScheduledTick[id] = tickCounter + RESTORE_DELAY_TICKS
            dprint("schedule restore", id, "at tick", restoreScheduledTick[id])
            return
        end
        if tickCounter >= restoreScheduledTick[id] then
            applyRestore(player)
        end
    end)
end

local function onClientCommand(module, command, player, args)
    if module ~= MOD then return end

    if command == CMD_RESTORE_DONE then
        if not player then return end
        local id = player:getUsername()
        if not id or id == "" then return end
        if not pendingRecovery[id] and not restoreAttempted[id] then return end

        local data = ModData.getOrCreate(MOD_KEY)
        if player.Say then
            player:Say("I remember fragments of my past life...")
        end
        finishRecovery(player, id, data)
        dprint("restoreXpDone from client", id)
        return
    end

    if command ~= CMD_SNAPSHOT then return end
    if not player then
        dprint("OnClientCommand: no player")
        return
    end

    local id = player:getUsername()
    if not id or id == "" then return end

    dprint("OnClientCommand saveSnapshot from", id)

    local xpFixed = {}
    if args and args.xp then
        for k, v in pairs(args.xp) do
            if type(v) == "number" and v > 0 then
                local idx = tonumber(k)
                if idx then
                    xpFixed[idx] = v
                elseif type(k) == "string" and k ~= "" then
                    xpFixed[k] = v
                end
            end
        end
    end

    for k, v in pairs(xpFixed) do
        dprint("saveSnapshot XP", id, tostring(k) .. "=" .. tostring(v))
    end

    local data = ModData.getOrCreate(MOD_KEY)
    data[id] = {
        xp = xpFixed,
        recipes = (args and args.recipes) or {},
    }
    ModData.transmit(MOD_KEY)

    pendingRecovery[id] = true
    restoreScheduledTick[id] = nil
    restoreAttempted[id] = nil
    player:getModData().XPRecovered = false

    dprint("stored pendingRecovery for", id)
end

local function register()
    if eventsRegistered then return end
    if not Events then return end

    if Events.OnClientCommand then
        Events.OnClientCommand.Add(onClientCommand)
        dprint("OnClientCommand registered")
    else
        print("[XPRecovery][SRV] ERROR: Events.OnClientCommand missing")
    end

    if Events.OnTick then
        Events.OnTick.Add(onTick)
        dprint("OnTick registered")
    end

    eventsRegistered = true
    print("[XPRecovery][SRV] registered")
end

if Events.OnServerStarted then
    Events.OnServerStarted.Add(register)
end
if Events.OnGameBoot then
    Events.OnGameBoot.Add(register)
end
register()

print("[XPRecovery][SRV] file loaded")
