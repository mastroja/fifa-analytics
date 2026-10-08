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
-- export_all.lua defines stand-ins for GetPlayersStats / GetCompetitionNameByObjID when they are nil, and Lua globals
-- survive between scripts in the same Live Editor session. So after any F10 press this probe would see a "function" that
-- is really that stub. debug.getinfo tells them apart: a native function reports what = "C", a stub reports "Lua" and the
-- file it came from. For a clean answer, restart the game, load the career and run this probe BEFORE pressing F10.
local function origin(f)
    if type(f) ~= "function" then return "" end
    if type(debug) ~= "table" or type(debug.getinfo) ~= "function" then return " (cannot tell native from stub: no debug library)" end
    local ok, info = pcall(debug.getinfo, f, "S")
    if not ok or not info then return " (unknown origin)" end
    if info.what == "C" then return " -> NATIVE (provided by Live Editor)" end
    return " -> Lua function defined in " .. tostring(info.short_src or info.source) .. " (a stand-in, NOT native)"
end
for _, nm in ipairs(names) do
    log(string.format("  %-28s %s%s", nm, type(_G[nm]), origin(_G[nm])))
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
