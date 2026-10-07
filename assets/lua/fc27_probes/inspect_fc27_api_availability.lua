-- ============================================================
-- FC 27 API AVAILABILITY — step 3. Tiny, low risk.
--
-- export_all.lua leans on several v1 global functions that were nil in the
-- first FC 27 probe (v27.1.0 era). This checks, for the CURRENT Live Editor
-- build, which of them exist (type() only), then makes ONE call to each
-- documented, read-only function with known-good arguments.
-- No memory offsets, no table walks.
--
-- Run via Live Editor's Lua Engine (NOT bound to F10).
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_api_report.txt
-- ============================================================

require 'imports/other/helpers'

local report = {}
local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_api_report.txt"
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end
local function log(line) table.insert(report, line); flush_report() end

log("==== type() of each global export_all.lua depends on ====")
local names = {
    "IsInCM", "GetSaveUID", "GetCurrentDate", "GetUserTeamID",
    "GetTeamName", "GetPlayerName", "GetTeamIdFromPlayerId",
    "GetPlayersStats", "GetPlayerStats", "GetCompetitionNameByObjID",
    "GetCompetitionNameByID", "GetPlugin", "GetManagerObjByTypeId",
    "GetDBTableFields", "GetDBTableRows", "GetDBTablesNames",
    "GetTransferBudget",
}
for _, n in ipairs(names) do
    log(string.format("  %-28s %s", n, type(_G[n])))
end

log("")
log("==== one safe call each (pcall) ====")
local function try(label, fn, ...)
    local ok, a = pcall(fn, ...)
    log(string.format("  %-40s %s", label, tostring(ok and a or ("ERROR: " .. tostring(a)))))
    return ok and a or nil
end

local team = try("GetUserTeamID()", GetUserTeamID)
if type(GetTeamName) == "function" and team then try("GetTeamName(user team)", GetTeamName, team) end
if type(GetTeamIdFromPlayerId) == "function" then try("GetTeamIdFromPlayerId(20801)", GetTeamIdFromPlayerId, 20801) end
if type(GetPlayerName) == "function" then try("GetPlayerName(20801)", GetPlayerName, 20801) end
if type(GetCompetitionNameByObjID) == "function" then try("GetCompetitionNameByObjID(0)", GetCompetitionNameByObjID, 0) end
if type(GetPlayersStats) == "function" then
    local ok, stats = pcall(GetPlayersStats)
    log("  GetPlayersStats(): " .. (ok and stats and ("returned " .. #stats .. " rows") or ("ERROR/nil: " .. tostring(stats))))
    if ok and stats and stats[1] then
        local keys = {}
        for k in pairs(stats[1]) do table.insert(keys, tostring(k)) end
        table.sort(keys)
        log("  first row keys: " .. table.concat(keys, ", "))
    end
end

-- v2 PLAYERS_MANAGER name lookup (what FC 27's own scripts use)
local pm = LE and LE.players_manager
log("  LE.players_manager: " .. type(pm))
if pm and type(pm.GetPlayerName) == "function" then
    try("LE.players_manager:GetPlayerName(20801)", pm.GetPlayerName, pm, 20801)
end

log("")
log("==== DONE ====")
print("FC27 API availability report written to " .. out_path)
