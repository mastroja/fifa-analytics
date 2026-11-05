-- ============================================================
-- FC 27 SEASON STATS — Live Editor v27.1.8+ (step 9).
--
-- v27.1.8 added "Season Statistics" to the Player Editor, and its DLL now
-- binds GetPlayersStats / GetPlayerStats / GetTeamIdFromPlayerId /
-- GetCompetitionNameByObjID / GetCompetitionNameByID as NATIVE Lua functions
-- (they were nil or returned 0 rows on v27.1.2 - v27.1.4). This probe answers,
-- before export_all.lua relies on them:
--   1. Are they native (not export_all.lua's stand-ins from an earlier F10)?
--   2. What does one GetPlayersStats() row look like on FC 27 (which keys:
--      compname? compobjid? teamid?) and how many rows are there?
--   3. Which competitions and how many teams are covered — only the user's
--      competitions + European/international cups (per DOC.MD), or every league?
--   4. Do GetCompetitionNameByObjID(compobjid) names resolve, and which
--      competition is the user's league (cross-checked against leagueteamlinks)?
--   5. Do the counts look right? (top scorers per competition, the user's squad)
--
-- Only native Lua functions and DB table reads. No raw memory, no writes.
-- Run via Live Editor's Lua Engine (NOT bound to F10). For a clean answer to
-- question 1, restart the game, load the career and run this BEFORE pressing F10.
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_season_stats_report.txt
-- Flushed after every section so a crash still leaves a partial report.
-- ============================================================

require 'imports/other/helpers'

local report = {}
local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_season_stats_report.txt"
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end
local function log(line) table.insert(report, line) end
local function section(title)
    flush_report()
    log(""); log("==================== " .. title .. " ====================")
end

local function sorted_keys(t)
    local keys = {}
    for k in pairs(t) do table.insert(keys, k) end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    return keys
end

local function origin(f)
    if type(f) ~= "function" then return "" end
    if type(debug) ~= "table" or type(debug.getinfo) ~= "function" then return " (no debug library)" end
    local ok, info = pcall(debug.getinfo, f, "S")
    if not ok or not info then return " (unknown origin)" end
    if info.what == "C" then return " -> NATIVE" end
    return " -> Lua stand-in from " .. tostring(info.short_src or info.source) .. " (restart the game and re-run before F10)"
end

local function safe_name(pid)
    local ok, n = pcall(GetPlayerName, pid)
    return (ok and n) or ("#" .. tostring(pid))
end

local team_name_cache = {}
local function team_name(tid)
    if tid == nil then return "?" end
    if team_name_cache[tid] == nil then
        local ok, n = pcall(GetTeamName, tid)
        team_name_cache[tid] = (ok and n) or ("#" .. tostring(tid))
    end
    return team_name_cache[tid]
end

local comp_name_cache = {}
local function comp_name(objid)
    if objid == nil then return nil end
    if comp_name_cache[objid] == nil then
        local name = false
        if type(GetCompetitionNameByObjID) == "function" then
            local ok, n = pcall(GetCompetitionNameByObjID, objid)
            if ok and n and n ~= "" then name = n end
        end
        comp_name_cache[objid] = name
    end
    return comp_name_cache[objid] or nil
end

local function row_line(r)
    local parts = {}
    for _, k in ipairs(sorted_keys(r)) do table.insert(parts, tostring(k) .. "=" .. tostring(r[k])) end
    return table.concat(parts, " ")
end

-- ------------------------------------------------------------
section("1. FUNCTIONS (type + native/stand-in)")
local ok_ver, le_ver = pcall(function() return LE and LE.version end)
log("  LE.version: " .. tostring(ok_ver and le_ver or "?"))
for _, nm in ipairs({
    "GetPlayersStats", "GetPlayerStats", "GetTeamIdFromPlayerId",
    "GetCompetitionNameByObjID", "GetCompetitionNameByID",
    "IsPlayerTransferListed", "IsPlayerLoanListed", "SetSquadRole",
    "PlayerDevelopmentManagerLoad", "PlayerHasDevelopementPlan",
    "AddTransferBan", "RemoveTransferBan",
}) do
    log(string.format("  %-32s %s%s", nm, type(_G[nm]), origin(_G[nm])))
end

local user_team = GetUserTeamID()
local ok_cd, cd = pcall(GetCurrentDate)
log(string.format("  user team: %s (%s)   in-game date: %s", tostring(user_team), team_name(user_team),
    (ok_cd and cd) and string.format("%04d-%02d-%02d", cd.year, cd.month, cd.day) or "?"))

-- ------------------------------------------------------------
section("2. GetPlayersStats() SHAPE")
local stats = {}
if type(GetPlayersStats) == "function" then
    local ok, s = pcall(GetPlayersStats)
    if ok and type(s) == "table" then stats = s else log("  ERROR: " .. tostring(s)) end
end
log("  rows: " .. #stats)
local key_count = {}
for i = 1, #stats do
    for k in pairs(stats[i]) do key_count[k] = (key_count[k] or 0) + 1 end
end
log("  keys (rows that have it):")
for _, k in ipairs(sorted_keys(key_count)) do log(string.format("    %-18s %d", tostring(k), key_count[k])) end
log("  first 5 rows:")
for i = 1, math.min(5, #stats) do log("    " .. row_line(stats[i])) end

-- ------------------------------------------------------------
section("3. COMPETITIONS COVERED")
-- Group by whichever competition key the rows actually carry.
local comps = {}
local players_seen, teams_seen = {}, {}
local user_rows = 0
for i = 1, #stats do
    local r = stats[i]
    local key = r.compobjid ~= nil and ("obj:" .. tostring(r.compobjid)) or ("name:" .. tostring(r.compname))
    local c = comps[key]
    if not c then
        c = { objid = r.compobjid, name = r.compname, rows = 0, teams = {}, nteams = 0, apps = 0, goals = 0, assists = 0, user_apps = 0 }
        comps[key] = c
    end
    c.rows = c.rows + 1
    c.apps = c.apps + (r.app or 0)
    c.goals = c.goals + (r.goals or 0)
    c.assists = c.assists + (r.assists or 0)
    if r.teamid ~= nil then
        if not c.teams[r.teamid] then c.teams[r.teamid] = true; c.nteams = c.nteams + 1 end
        teams_seen[r.teamid] = true
        if r.teamid == user_team then c.user_apps = c.user_apps + (r.app or 0); user_rows = user_rows + 1 end
    end
    if r.playerid then players_seen[r.playerid] = true end
end
local function count(t) local n = 0 for _ in pairs(t) do n = n + 1 end return n end
log(string.format("  distinct players: %d   distinct teams: %d   rows for user team: %d", count(players_seen), count(teams_seen), user_rows))
log("  per competition (objid | name from row | name from GetCompetitionNameByObjID | rows | teams | apps | goals | assists | user-team apps):")
local comp_list = {}
for _, c in pairs(comps) do table.insert(comp_list, c) end
table.sort(comp_list, function(a, b) return a.rows > b.rows end)
for _, c in ipairs(comp_list) do
    log(string.format("    %-10s | %-28s | %-28s | %5d | %3d | %6d | %5d | %5d | %d",
        tostring(c.objid), tostring(c.name), tostring(comp_name(c.objid)), c.rows, c.nteams, c.apps, c.goals, c.assists, c.user_apps))
end

-- ------------------------------------------------------------
section("4. USER LEAGUE (leagueteamlinks cross-check)")
-- leagueteamlinks standings are stale on FC 27, but team -> league membership should still hold.
-- The competition whose teams best match the user's league's team set is the league competition.
local league_teams, user_league = {}, nil
local ok_ltl, ltl = pcall(function() return LE.db:GetTable("leagueteamlinks") end)
if ok_ltl and ltl then
    local rec, n = ltl:GetFirstRecord(), 0
    local rows = {}
    while rec and rec > 0 and n < 5000 do
        n = n + 1
        local tid = ltl:GetRecordFieldValue(rec, "teamid")
        local lid = ltl:GetRecordFieldValue(rec, "leagueid")
        if tid and lid then
            table.insert(rows, { tid, lid })
            if tid == user_team then user_league = lid end
        end
        rec = ltl:GetNextValidRecord()
    end
    for _, r in ipairs(rows) do if r[2] == user_league then league_teams[r[1]] = true end end
    log(string.format("  leagueteamlinks rows: %d   user leagueid: %s   teams in that league: %d", n, tostring(user_league), count(league_teams)))
    local names = {}
    for tid in pairs(league_teams) do table.insert(names, team_name(tid)) end
    table.sort(names)
    log("  teams: " .. table.concat(names, ", "))
else
    log("  leagueteamlinks not readable")
end
local ok_lg, lg = pcall(function() return LE.db:GetTable("leagues") end)
if ok_lg and lg and user_league then
    local rec, n = lg:GetFirstRecord(), 0
    while rec and rec > 0 and n < 2000 do
        n = n + 1
        if lg:GetRecordFieldValue(rec, "leagueid") == user_league then
            local ok_n, nm = pcall(lg.GetRecordFieldValue, lg, rec, "leaguename")
            log("  leagues.leaguename for user league: " .. tostring(ok_n and nm or "?"))
            break
        end
        rec = lg:GetNextValidRecord()
    end
end
if type(GetCompetitionNameByID) == "function" and user_league then
    local ok_c, nm = pcall(GetCompetitionNameByID, user_league)
    log("  GetCompetitionNameByID(user leagueid): " .. tostring(ok_c and nm or ("ERROR: " .. tostring(nm))))
end
log("  overlap of each competition's teams with the user's league:")
for _, c in ipairs(comp_list) do
    local overlap = 0
    for tid in pairs(c.teams) do if league_teams[tid] then overlap = overlap + 1 end end
    if overlap > 0 then
        log(string.format("    %-10s %-28s overlap %d/%d (comp has %d teams)", tostring(c.objid), tostring(comp_name(c.objid) or c.name), overlap, count(league_teams), c.nteams))
    end
end

-- ------------------------------------------------------------
section("5. TOP 5 SCORERS PER COMPETITION (compare with the in-game stats screen)")
for ci, c in ipairs(comp_list) do
    if ci > 12 then log("  ... (more competitions not shown)"); break end
    local list = {}
    for i = 1, #stats do
        local r = stats[i]
        if (c.objid ~= nil and r.compobjid == c.objid) or (c.objid == nil and r.compname == c.name) then table.insert(list, r) end
    end
    table.sort(list, function(a, b) return (a.goals or 0) > (b.goals or 0) end)
    log(string.format("  %s (%s):", tostring(comp_name(c.objid) or c.name), tostring(c.objid)))
    for i = 1, math.min(5, #list) do
        local r = list[i]
        log(string.format("    %-26s %-22s apps %2d goals %2d assists %2d avg_raw %s motm %s",
            safe_name(r.playerid), team_name(r.teamid), r.app or 0, r.goals or 0, r.assists or 0, tostring(r.avg), tostring(r.motm)))
    end
end

-- ------------------------------------------------------------
section("6. USER SQUAD: GetPlayersStats rows vs GetPlayerStats(pid) vs GetTeamIdFromPlayerId")
local squad = {}
local ok_tpl, tpl = pcall(function() return LE.db:GetTable("teamplayerlinks") end)
if ok_tpl and tpl then
    local rec, n = tpl:GetFirstRecord(), 0
    while rec and rec > 0 and n < 40000 do
        n = n + 1
        if tpl:GetRecordFieldValue(rec, "teamid") == user_team then
            table.insert(squad, tpl:GetRecordFieldValue(rec, "playerid"))
        end
        rec = tpl:GetNextValidRecord()
    end
end
log("  squad size (teamplayerlinks): " .. #squad)
local by_player = {}
for i = 1, #stats do
    local r = stats[i]
    if r.playerid then
        by_player[r.playerid] = by_player[r.playerid] or {}
        table.insert(by_player[r.playerid], r)
    end
end
for si = 1, math.min(8, #squad) do
    local pid = squad[si]
    log(string.format("  %s (%d):", safe_name(pid), pid))
    if type(GetTeamIdFromPlayerId) == "function" then
        local ok_t, t = pcall(GetTeamIdFromPlayerId, pid)
        log("    GetTeamIdFromPlayerId -> " .. tostring(ok_t and t or ("ERROR: " .. tostring(t))))
    end
    for _, r in ipairs(by_player[pid] or {}) do log("    all-stats row: " .. row_line(r)) end
    if type(GetPlayerStats) == "function" then
        local ok_p, ps = pcall(GetPlayerStats, pid)
        if ok_p and type(ps) == "table" then
            -- documented as an array of per-competition rows; log both shapes in case it is a single row
            if #ps > 0 then
                for _, r in ipairs(ps) do log("    GetPlayerStats row: " .. row_line(r)) end
            else
                log("    GetPlayerStats (non-array): " .. row_line(ps))
            end
        else
            log("    GetPlayerStats -> " .. tostring(ok_p and ps or ("ERROR: " .. tostring(ps))))
        end
    end
    if type(IsPlayerTransferListed) == "function" then
        local ok_l, l = pcall(IsPlayerTransferListed, pid)
        log("    IsPlayerTransferListed -> " .. (ok_l and tostring(l) or ("ERROR: " .. tostring(l))))
    end
end

-- ------------------------------------------------------------
section("7. PLAYER DEVELOPMENT FILE (Development Exp Bonus / Multiplier / No Decline)")
-- v2 lib: PlayerDevelopmentManager saves to <LE>\extensions\careers\<SAVE_ID>\players_development.json.
-- Read-only check that the file exists for this save; edit one player in Player Editor first.
local uid = GetSaveUID() or ""
log("  save uid: " .. uid)
for _, base in ipairs({ "C:\\FC 27 Live Editor" }) do
    local p = base .. "\\extensions\\careers\\" .. uid .. "\\players_development.json"
    local f = io.open(p, "r")
    if f then
        local body = f:read("*a") or ""; f:close()
        log("  found " .. p .. " (" .. #body .. " bytes): " .. body:sub(1, 600))
    else
        log("  not found: " .. p)
    end
end

section("DONE")
log("No raw memory was read and nothing was written. Send the whole file back to Claude: " .. out_path)
flush_report()
print("FC27 season stats report written to " .. out_path)
