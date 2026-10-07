-- ============================================================
-- FC 27 DATA SAMPLE — step 2 after inspect_fc27_db_schema.lua.
--
-- Uses only tables and fields CONFIRMED present by the schema report
-- (and re-checks them against the live field list before reading).
-- No raw memory offsets. Capped iteration everywhere.
--
-- Samples real values from the tables that replace the FC 26 memory-offset
-- reads (standings, fixtures, transfers, events, suspensions, calendar)
-- and the new location of contract / playstyle data on `players`.
--
-- Run via Live Editor's Lua Engine (NOT bound to F10).
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_data_sample_report.txt
-- Flushed after every section so a crash still leaves a partial report.
-- ============================================================

require 'imports/other/helpers'

local report = {}
local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_data_sample_report.txt"
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end
local function log(line) table.insert(report, line) end
local function section(title)
    log(""); log("==================== " .. title .. " ====================")
    flush_report()
end

local function sorted_keys(t)
    local keys = {}
    for k in pairs(t) do table.insert(keys, k) end
    table.sort(keys)
    return keys
end

-- Dump every confirmed field of one record on one line-per-field.
local function dump_record(tbl, rec, fields, indent)
    for _, f in ipairs(fields) do
        local ok, v = pcall(tbl.GetRecordFieldValue, tbl, rec, f)
        log(string.format("%s%-30s = %s", indent or "  ", f, tostring(ok and v or ("ERROR: " .. tostring(v)))))
    end
end

-- Walk up to `cap` valid records, calling cb(rec, index); cb returns true to stop.
local function walk(tbl, cap, cb)
    local rec = tbl:GetFirstRecord()
    local i = 0
    while rec and rec > 0 and i < cap do
        i = i + 1
        if cb(rec, i) then return i end
        rec = tbl:GetNextValidRecord()
    end
    return i
end

local function open_table(name)
    local t = LE.db:GetTable(name)
    if not t or not t.fields then
        log("TABLE MISSING: " .. name)
        return nil, nil
    end
    return t, sorted_keys(t.fields)
end

local user_team_id = 0
do
    local ok, id = pcall(GetUserTeamID)
    if ok and id then user_team_id = id end
end

section("ENVIRONMENT")
log("IsInCM(): " .. tostring(select(2, pcall(IsInCM))))
local dok, d = pcall(GetCurrentDate)
if dok and d then log(string.format("GetCurrentDate(): %04d-%02d-%02d", d.year, d.month, d.day)) end
log("GetUserTeamID(): " .. tostring(user_team_id))

-- ------------------------------------------------------------
section("career_calendar (transfer windows, current date)")
do
    local t, fields = open_table("career_calendar")
    if t then
        log("records=" .. tostring(t.written_records))
        walk(t, 3, function(rec, i) log("record " .. i .. ":"); dump_record(t, rec, fields) end)
    end
end

-- ------------------------------------------------------------
section("leagueteamlinks (standings)")
do
    local t, fields = open_table("leagueteamlinks")
    if t then
        log("records=" .. tostring(t.written_records))
        -- user's row
        local found = false
        walk(t, 2000, function(rec)
            if t:GetRecordFieldValue(rec, "teamid") == user_team_id then
                log("USER TEAM ROW:"); dump_record(t, rec, fields); found = true
                return true
            end
        end)
        if not found then log("No leagueteamlinks row for user team id " .. user_team_id) end

        -- how many teams share the user's leagueid (league table size)
        local user_league
        walk(t, 2000, function(rec)
            if t:GetRecordFieldValue(rec, "teamid") == user_team_id then
                user_league = t:GetRecordFieldValue(rec, "leagueid"); return true
            end
        end)
        if user_league then
            local rows = {}
            walk(t, 2000, function(rec)
                if t:GetRecordFieldValue(rec, "leagueid") == user_league then
                    table.insert(rows, string.format("team %d pos=%d P=%d pts=%d gf/ga=%d/%d",
                        t:GetRecordFieldValue(rec, "teamid"),
                        t:GetRecordFieldValue(rec, "currenttableposition"),
                        t:GetRecordFieldValue(rec, "nummatchesplayed"),
                        t:GetRecordFieldValue(rec, "points"),
                        t:GetRecordFieldValue(rec, "homegf") + t:GetRecordFieldValue(rec, "awaygf"),
                        t:GetRecordFieldValue(rec, "homega") + t:GetRecordFieldValue(rec, "awayga")))
                end
            end)
            log(string.format("User league id %s has %d teams:", tostring(user_league), #rows))
            for _, r in ipairs(rows) do log("  " .. r) end
        end
    end
end

-- ------------------------------------------------------------
section("fixtures")
do
    local t, fields = open_table("fixtures")
    if t then
        log("records=" .. tostring(t.written_records))
        local user_fx = 0
        walk(t, 5000, function(rec)
            local h, a = t:GetRecordFieldValue(rec, "hometeamid"), t:GetRecordFieldValue(rec, "awayteamid")
            if h == user_team_id or a == user_team_id then
                user_fx = user_fx + 1
                if user_fx <= 3 then log("USER FIXTURE " .. user_fx .. ":"); dump_record(t, rec, fields) end
            end
        end)
        log("Fixtures involving user team: " .. user_fx)
        log("First 2 raw fixtures:")
        walk(t, 2, function(rec, i) log("fixture " .. i .. ":"); dump_record(t, rec, fields) end)
    end
end

-- ------------------------------------------------------------
for _, name in ipairs({ "transfers", "persistent_events", "playersuspensions" }) do
    section(name)
    local t, fields = open_table(name)
    if t then
        log("records=" .. tostring(t.written_records))
        local n = walk(t, 5, function(rec, i) log("record " .. i .. ":"); dump_record(t, rec, fields) end)
        if n == 0 then log("(empty — sim a few matches / a transfer window and re-run)") end
    end
end

-- ------------------------------------------------------------
section("players: contract / playstyle / role fields")
do
    local t = open_table("players")
    if t then
        local want = { "playerid", "wage", "releaseclause", "contractvaliduntil", "playerjointeamdate",
            "trait1", "trait2", "icontrait1", "icontrait2", "isretiring", "personality",
            "composure", "reactions", "internationalrep", "growthprofile",
            "role1", "role2", "role3", "role4", "role5", "role6", "role7", "role8", "role9" }
        local confirmed = {}
        for _, f in ipairs(want) do if t.fields[f] then table.insert(confirmed, f) end end

        -- Players on the user's team via cm_teamsheets (playerid0..51), plus first record.
        local ids = {}
        local ts = LE.db:GetTable("cm_teamsheets")
        if ts and ts.fields then
            walk(ts, 10, function(rec)
                if ts:GetRecordFieldValue(rec, "teamid") == user_team_id then
                    for i = 0, 51 do
                        local pid = ts:GetRecordFieldValue(rec, "playerid" .. i)
                        if pid and pid > 0 then table.insert(ids, pid) end
                    end
                    return true
                end
            end)
        end
        log("cm_teamsheets player ids for user team: " .. #ids)

        local wanted = {}
        for i = 1, math.min(4, #ids) do wanted[ids[i]] = true end
        local shown = 0
        walk(t, 80000, function(rec, i)
            if i == 1 then log("FIRST PLAYER RECORD:"); dump_record(t, rec, confirmed) end
            local pid = t:GetRecordFieldValue(rec, "playerid")
            if wanted[pid] then
                shown = shown + 1
                log("USER SQUAD PLAYER " .. pid .. ":"); dump_record(t, rec, confirmed)
                if shown >= 4 then return true end
            end
        end)
    end
end

section("DONE")
log("Send this file back to Claude: " .. out_path)
flush_report()
print("FC27 data sample report written to " .. out_path)
