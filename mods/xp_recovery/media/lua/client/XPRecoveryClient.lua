--[[ XPRecovery — CLIENT — death snapshot -> server; apply XP locally after respawn (server sendServerCommand) ]]

local MOD = "XPRecovery"
local CMD = "saveSnapshot"
local CMD_RESTORE_DONE = "restoreXpDone"

local DEBUG = true

--- One AddXP per tick max. Bursting dozens in a single frame triggers PacketValidator kick (type AddXp, Type15).
local XP_RESTORE_PER_TICK = 1

local pendingRestoreQueue = nil

local function dprint(...)
    if not DEBUG then return end
    print("[XPRecovery][CLIENT] " .. table.concat({ ... }, " "))
end

local function countKeys(t)
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n
end

local function buildSnapshot(player)
    local xpData = {}
    for i = 0, Perks.getMaxIndex() - 1 do
        local perk = Perks.fromIndex(i)
        if perk then
            local xp = player:getXp():getXP(perk)
            if xp and xp > 0 then
                -- Must use perk index, not getName(): display names differ by locale and client vs server.
                xpData[tostring(i)] = xp * 0.8
            end
        end
    end

    local recipes = {}
    local known = player:getKnownRecipes()
    if known and known.size then
        for i = 0, known:size() - 1 do
            table.insert(recipes, known:get(i))
        end
    end

    return xpData, recipes
end

local function buildRestoreQueue(xpTable)
    local q = {}
    for k, xp in pairs(xpTable or {}) do
        local idx = tonumber(k)
        if idx and type(xp) == "number" and xp > 0 then
            table.insert(q, { idx = idx, xp = xp })
        end
    end
    return q
end

local function finishRestoreSession(player)
    local xpObj = player:getXp()
    if xpObj.recalcSumm then
        pcall(function() xpObj:recalcSumm() end)
    end

    player:getModData().XPRecovered = true
    pendingRestoreQueue = nil

    if sendClientCommand then
        sendClientCommand(player, MOD, CMD_RESTORE_DONE, {})
        dprint("sent restoreXpDone")
    else
        print("[XPRecovery][CLIENT] ERROR: sendClientCommand is nil")
    end
end

local function onPlayerDeath(player)
    if not player then
        dprint("OnPlayerDeath: player nil")
        return
    end

    local uname = player:getUsername() or "?"
    dprint("OnPlayerDeath username=", uname)

    local xpData, recipes = buildSnapshot(player)
    dprint("snapshot xpSlots=", countKeys(xpData), "recipes=", #recipes)

    local args = {
        xp = xpData,
        recipes = recipes,
    }

    -- Standard global (Build 41+): sendClientCommand(player, module, command, args)
    if sendClientCommand then
        sendClientCommand(player, MOD, CMD, args)
        dprint("sendClientCommand OK")
    else
        print("[XPRecovery][CLIENT] ERROR: sendClientCommand is nil")
    end
end

local function drainRestoreQueue(player)
    if not pendingRestoreQueue or not player then return end

    local md = player:getModData()
    if md.XPRecovered then
        pendingRestoreQueue = nil
        return
    end

    local xpObj = player:getXp()
    local n = 0
    while n < XP_RESTORE_PER_TICK and #pendingRestoreQueue > 0 do
        local entry = table.remove(pendingRestoreQueue, 1)
        local perk = Perks.fromIndex(entry.idx)
        if perk then
            local ok, err = pcall(function()
                xpObj:AddXP(perk, entry.xp)
            end)
            if ok then
                dprint("restoreXp", perk.getName and perk:getName() or entry.idx, "=", entry.xp)
            else
                dprint("restoreXp AddXP FAILED", entry.idx, tostring(err))
            end
        end
        n = n + 1
    end

    if #pendingRestoreQueue == 0 then
        finishRestoreSession(player)
    end
end

local function onServerCommand(module, command, args)
    if module ~= MOD or command ~= "restoreXp" then return end
    if not args or not args.xp then return end
    pendingRestoreQueue = buildRestoreQueue(args.xp)
    dprint("restoreXp queued", #pendingRestoreQueue, "skills (throttled)")
    local p = getPlayer()

    if p then
        p:Say("I think i just shat on my pants...")
    end

    if p and #pendingRestoreQueue == 0 then
        finishRestoreSession(p)
    end
end

local function onPlayerUpdate(player)
    if not pendingRestoreQueue or not player then return end
    local lp = getPlayer()
    if lp and player == lp then
        drainRestoreQueue(player)
    end
end

Events.OnPlayerDeath.Add(onPlayerDeath)
Events.OnServerCommand.Add(onServerCommand)
Events.OnPlayerUpdate.Add(onPlayerUpdate)
print("[XPRecovery][CLIENT] loaded")
