-- ============================================================
-- FC 27 DB SCHEMA CHECK (v2 API) — low risk, run standalone.
--
-- The earlier version of this script used v1 functions
-- (GetDBTableFields / GetTeamName / GetPlayerName) which do not exist in
-- FC 27's Live Editor, so every call returned nil. This version uses the
-- same v2 table API as assets/export_all.lua (LE.db / T3DB tables).
--
-- Phase 1: LE.db:Load() walks the table list and reads table + field
--          METADATA only (names, types, offsets, record counts). No record
--          is touched. Everything found is written to the report.
-- Phase 2: for each table export_all.lua depends on, compares expected
--          field names against the real field list, and only samples a
--          value off the first record for fields confirmed present.
--
-- Run via Live Editor's Lua Engine (NOT bound to F10).
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_db_schema_report.txt
-- (flushed after every section so a crash still leaves a partial report)
-- ============================================================

require 'imports/other/helpers'

local report = {}
local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_db_schema_report.txt"
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then
        f:write(table.concat(report, "\n"))
        f:close()
    end
end
local function log(line) table.insert(report, line) end
local function section(title)
    log("")
    log("==================== " .. title .. " ====================")
    flush_report()
end

local function sorted_keys(t)
    local keys = {}
    for k in pairs(t) do table.insert(keys, k) end
    table.sort(keys)
    return keys
end

-- ------------------------------------------------------------
section("BASIC ENVIRONMENT")
local ok, in_cm = pcall(IsInCM)
log("IsInCM(): " .. tostring(ok and in_cm or ("ERROR: " .. tostring(in_cm))))
local ok2, save_uid = pcall(GetSaveUID)
log("GetSaveUID(): " .. tostring(ok2 and save_uid or ("ERROR: " .. tostring(save_uid))))
local ok3, d = pcall(GetCurrentDate)
if ok3 and d then
    log(string.format("GetCurrentDate(): %04d-%02d-%02d", d.year, d.month, d.day))
else
    log("GetCurrentDate(): ERROR: " .. tostring(d))
end
local ok4, uid = pcall(GetUserTeamID)
log("GetUserTeamID(): " .. tostring(ok4 and uid or ("ERROR: " .. tostring(uid))))
log("LE.db present: " .. tostring(LE ~= nil and LE.db ~= nil))

-- ------------------------------------------------------------
-- PHASE 1 — enumerate every table + field (metadata only)
-- ------------------------------------------------------------
section("PHASE 1: ALL TABLES")
local lok, lerr = pcall(function() LE.db:Reset() end)
log("LE.db:Reset() (loads all table metadata): " .. tostring(lok and "OK" or ("ERROR: " .. tostring(lerr))))

local tables = (LE.db and LE.db.tables) or {}
log("Tables found: " .. tostring(LE.db and LE.db.tables_count))

local names = sorted_keys(tables)
log("Table list: " .. table.concat(names, ", "))
flush_report()

for _, tname in ipairs(names) do
    local tbl = tables[tname]
    section("TABLE (meta): " .. tname)
    log(string.format("shortname=%s records=%s record_size=%s",
        tostring(tbl.shortname), tostring(tbl.written_records), tostring(tbl.record_size)))
    if tbl.fields then
        local fnames = sorted_keys(tbl.fields)
        log(string.format("fields (%d):", #fnames))
        for _, fname in ipairs(fnames) do
            local fld = tbl.fields[fname]
            log(string.format("  %-34s type=%s offset=%s size=%s",
                fname, tostring(fld.type), tostring(fld.offset), tostring(fld.sz)))
        end
    else
        log("fields: NONE (no field metadata for this table)")
    end
end

-- ------------------------------------------------------------
-- PHASE 2 — tables export_all.lua depends on
-- ------------------------------------------------------------
local function check_table(table_name, expected_fields)
    section("PHASE 2 CHECK: " .. table_name)

    local tbl = tables[table_name]
    if not tbl or not tbl.fields then
        log("TABLE MISSING in FC 27 (or no field metadata).")
        return
    end

    local present, missing = {}, {}
    for _, f in ipairs(expected_fields) do
        if tbl.fields[f] then table.insert(present, f) else table.insert(missing, f) end
    end
    log("Expected fields PRESENT (" .. #present .. "): " .. table.concat(present, ", "))
    log("Expected fields MISSING (" .. #missing .. "): " .. (#missing > 0 and table.concat(missing, ", ") or "none"))

    if #present == 0 then return end
    local live = LE.db:GetTable(table_name)
    if not live then
        log("GetTable() returned nil; skipping samples.")
        return
    end
    local rec = live:GetFirstRecord()
    if rec and rec > 0 then
        log("Sample values from first record:")
        for _, f in ipairs(present) do
            local vok, val = pcall(live.GetRecordFieldValue, live, rec, f)
            log(string.format("  %-30s = %s", f, tostring(vok and val or ("ERROR: " .. tostring(val)))))
        end
    else
        log("No valid first record.")
    end
    flush_report()
end

check_table("players", {
    "playerid", "preferredposition1", "preferredposition2", "overallrating", "potential",
    "nationality", "skintonecode", "headassetid", "birthdate", "height", "weight",
    "playerjointeamdate", "preferredfoot", "skillmoves", "weakfootabilitytypecode",
    "contractvaliduntil", "acceleration", "sprintspeed", "finishing", "longshots",
    "shotpower", "positioning", "penalties", "volleys", "shortpassing", "vision",
    "crossing", "longpassing", "curve", "freekickaccuracy", "dribbling", "ballcontrol",
    "agility", "balance", "defensiveawareness", "marking", "standingtackle",
    "interceptions", "headingaccuracy", "slidingtackle", "strength", "stamina",
    "aggression", "jumping", "gkdiving", "gkhandling", "gkkicking", "gkpositioning",
    "gkreflexes"
})
check_table("playerloans", { "playerid", "teamidloanedfrom", "loandateend", "isloantobuy" })
check_table("career_playercontract", {
    "playerid", "teamid", "wage", "duration_months", "contract_date", "playerrole", "last_status_change_date"
})
check_table("cm_teamsheets", { "teamid", "playerid1", "playerid2", "playerid51" })
check_table("teamplayerlinks", {
    "playerid", "teamid", "isamongtopscorers", "jerseynumber", "injury",
    "leaguegoalsprevthreematches", "isamongtopscorersinteam", "form"
})
check_table("playertraits", { "playerid", "traitid" })
check_table("playerplaystyles", { "playerid", "playstyleid" })
check_table("career_youthplayers", { "playerid", "playertier", "monthsinsquad", "potentialvariance" })
check_table("teams", {
    "teamid", "captainid", "teamcolor1r", "teamcolor1g", "teamcolor1b",
    "teamcolor2r", "teamcolor2g", "teamcolor2b", "teamcolor3r", "teamcolor3g", "teamcolor3b",
    "leaguetitles", "domesticcups", "uefa_cl_wins", "uefa_el_wins", "uefa_uecl_wins"
})
check_table("manager", { "teamid", "firstname", "surname", "commonname", "managerjointeamdate" })
check_table("career_managerhistory", {
    "teamid", "season", "games_played", "points", "wins", "draws", "losses", "tableposition"
})
check_table("career_users", { "clubteamid", "nationalteamid" })

section("DONE")
log("No raw memory offsets (standings/fixtures/transfers) were touched.")
log("Send the whole file back to Claude: " .. out_path)
flush_report()
print("FC27 DB schema report written to " .. out_path)
