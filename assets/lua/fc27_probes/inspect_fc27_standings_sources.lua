-- ============================================================
-- FC 27 STANDINGS SOURCES — Live Editor v27.1.8+ (step 10).
--
-- Live Editor still has no Lua function for standings or fixtures (v27.1.7
-- added them to the Team Editor UI only). This probe checks what CAN be
-- built without memory reads:
--   1. leagueteamlinks for the user's league. An Oct 2026 sample showed
--      currenttableposition / nummatchesplayed / teamform live, but
--      W/D/L / goals / points all 0. Is that still so mid-season?
--   2. Team goals for / against / clean sheets rebuilt from GetPlayersStats
--      (league competition only; against + clean sheets from goalkeepers).
--   3. Any OTHER table with a team id and points/wins/goals columns that is
--      non-zero for the user's team (a live standings table we missed).
--   4. Transfer bans (v27.1.6+): the getter's real row keys.
--   5. Transfer-listed / loan-listed / loaned-out flags for the squad.
--
-- Compare section 1 + 2 with the in-game league table and form guide.
-- Only native Lua functions and DB table reads. No raw memory, no writes.
-- Run via Live Editor's Lua Engine (NOT bound to F10).
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_standings_sources_report.txt
-- ============================================================

require 'imports/other/helpers'

local report = {}
local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_standings_sources_report.txt"
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
local function row_line(r)
    local parts = {}
    for _, k in ipairs(sorted_keys(r)) do table.insert(parts, tostring(k) .. "=" .. tostring(r[k])) end
    return table.concat(parts, " ")
end
local team_name_cache = {}
local function team_name(tid)
    if tid == nil then return "?" end
    if team_name_cache[tid] == nil then
        local ok, n = pcall(GetTeamName, tid)
        team_name_cache[tid] = (ok and n and n ~= "") and n or ("#" .. tostring(tid))
    end
    return team_name_cache[tid]
end
-- Walk a table, calling cb(rec) for up to cap records.
local function walk(tbl, cap, cb)
    local rec, n = tbl:GetFirstRecord(), 0
    while rec and rec > 0 and n < cap do
        n = n + 1
        if cb(rec) then break end
        rec = tbl:GetNextValidRecord()
    end
    return n
end
local function v(tbl, rec, f)
    local ok, x = pcall(tbl.GetRecordFieldValue, tbl, rec, f)
    return ok and x or nil
end

local user_team = GetUserTeamID()
local ok_cd, cd = pcall(GetCurrentDate)
section("0. ENVIRONMENT")
log(string.format("  LE %s   user team %s (%s)   in-game %s", tostring(LE and LE.version), tostring(user_team), team_name(user_team),
    (ok_cd and cd) and string.format("%04d-%02d-%02d", cd.year, cd.month, cd.day) or "?"))

-- ------------------------------------------------------------
section("1. leagueteamlinks: USER LEAGUE, BY currenttableposition")
local LTL_FIELDS = { "currenttableposition", "nummatchesplayed", "points", "homewins", "homedraws", "homelosses", "awaywins",
    "awaydraws", "awaylosses", "homegf", "homega", "awaygf", "awaga", "awayga", "teamform", "lastgameresult", "teamshortform",
    "teamlongform", "unbeatenleague", "unbeatenhome", "unbeatenaway", "unbeatenallcomps", "yettowin", "champion",
    "actualvsexpectations", "previousyeartableposition", "highestpossible", "highestprobable", "objective", "hasachievedobjective" }
local league_rows, user_league = {}, nil
local ltl = LE.db:GetTable("leagueteamlinks")
if ltl then
    local all = {}
    walk(ltl, 5000, function(rec)
        local r = { teamid = v(ltl, rec, "teamid"), leagueid = v(ltl, rec, "leagueid") }
        for _, f in ipairs(LTL_FIELDS) do r[f] = v(ltl, rec, f) end
        all[#all + 1] = r
        if r.teamid == user_team then user_league = r.leagueid end
    end)
    for _, r in ipairs(all) do if r.leagueid == user_league then league_rows[#league_rows + 1] = r end end
    table.sort(league_rows, function(a, b) return (a.currenttableposition or 99) < (b.currenttableposition or 99) end)
    log(string.format("  rows %d   user leagueid %s   teams %d", #all, tostring(user_league), #league_rows))
    log("  pos team                       P  pts  W-D-L(home+away)  GF-GA     form   last unbeatenL yettowin")
    for _, r in ipairs(league_rows) do
        local w = (r.homewins or 0) + (r.awaywins or 0)
        local d = (r.homedraws or 0) + (r.awaydraws or 0)
        local l = (r.homelosses or 0) + (r.awaylosses or 0)
        local gf = (r.homegf or 0) + (r.awaygf or 0)
        local ga = (r.homega or 0) + (r.awayga or r.awaga or 0)
        log(string.format("  %3s %-26s %2s  %3s  %2d-%2d-%2d          %3d-%-3d  %6s %4s %9s %8s",
            tostring(r.currenttableposition), team_name(r.teamid), tostring(r.nummatchesplayed), tostring(r.points),
            w, d, l, gf, ga, tostring(r.teamform), tostring(r.lastgameresult), tostring(r.unbeatenleague), tostring(r.yettowin)))
    end
    local u
    for _, r in ipairs(league_rows) do if r.teamid == user_team then u = r end end
    if u then log("  user team row: " .. row_line(u)) end
else
    log("  leagueteamlinks not readable")
end

-- ------------------------------------------------------------
section("2. TEAM TOTALS REBUILT FROM GetPlayersStats (league competition)")
local league_comp = nil
if type(GetCompetitionNameByID) == "function" and user_league then
    local ok, n = pcall(GetCompetitionNameByID, user_league)
    if ok then league_comp = n end
end
log("  league competition name: " .. tostring(league_comp))
local gk = {}
local players = LE.db:GetTable("players")
if players then
    walk(players, 40000, function(rec)
        local pid = v(players, rec, "playerid")
        if pid and v(players, rec, "preferredposition1") == 0 then gk[pid] = true end
    end)
end
local totals = {}
local stats = {}
if type(GetPlayersStats) == "function" then
    local ok, s = pcall(GetPlayersStats)
    if ok and type(s) == "table" then stats = s end
end
for i = 1, #stats do
    local r = stats[i]
    if league_comp and r.compname == league_comp and r.teamid then
        local t = totals[r.teamid]
        if not t then t = { gf = 0, ga_gk = 0, cs_gk = 0, gk_apps = 0, max_app = 0, players = 0, motm = 0 }; totals[r.teamid] = t end
        t.gf = t.gf + (r.goals or 0)
        t.players = t.players + 1
        t.motm = t.motm + (r.motm or 0)
        if (r.app or 0) > t.max_app then t.max_app = r.app or 0 end
        if gk[r.playerid] then
            t.ga_gk = t.ga_gk + (r.goals_conceded or 0)
            t.cs_gk = t.cs_gk + (r.clean_sheets or 0)
            t.gk_apps = t.gk_apps + (r.app or 0)
        end
    end
end
log("  team                       P(ltl) GF  GA(GKs) CS(GKs) GK-apps max-player-apps motm")
for _, r in ipairs(league_rows) do
    local t = totals[r.teamid] or {}
    log(string.format("  %-26s %5s %3s %7s %7s %7s %15s %4s", team_name(r.teamid), tostring(r.nummatchesplayed),
        tostring(t.gf), tostring(t.ga_gk), tostring(t.cs_gk), tostring(t.gk_apps), tostring(t.max_app), tostring(t.motm)))
end
log("  (GF misses own goals. GA = goals conceded while each goalkeeper was on the pitch, summed. GK-apps should be >= P.)")

-- ------------------------------------------------------------
section("3. OTHER TABLES WITH TEAM STANDINGS-LIKE COLUMNS (user team rows)")
pcall(function() LE.db:Reset() end)
local tables = (LE.db and LE.db.tables) or {}
local WANT = { "points", "wins", "won", "draws", "losses", "lost", "goalsfor", "goalsagainst", "gf", "ga", "played", "position", "rank" }
for _, tname in ipairs(sorted_keys(tables)) do
    local meta = tables[tname]
    if meta and meta.fields and tname ~= "leagueteamlinks" then
        local team_field
        for _, tf in ipairs({ "teamid", "clubteamid", "hometeamid" }) do if meta.fields[tf] then team_field = tf; break end end
        local hits = {}
        for fname in pairs(meta.fields) do
            local fl = fname:lower()
            for _, w in ipairs(WANT) do if fl:find(w, 1, true) then hits[#hits + 1] = fname; break end end
        end
        if team_field and #hits > 0 then
            table.sort(hits)
            local tbl = LE.db:GetTable(tname)
            local found = 0
            if tbl then
                walk(tbl, 50000, function(rec)
                    if v(tbl, rec, team_field) == user_team then
                        found = found + 1
                        local parts = {}
                        for _, f in ipairs(hits) do parts[#parts + 1] = f .. "=" .. tostring(v(tbl, rec, f)) end
                        log(string.format("  %-32s [%s=%s] %s", tname, team_field, tostring(user_team), table.concat(parts, " ")))
                        return found >= 3
                    end
                end)
            end
            if found == 0 then log(string.format("  %-32s (no row for the user team; columns: %s)", tname, table.concat(hits, ","))) end
        end
    end
end

-- ------------------------------------------------------------
section("4. TRANSFER BANS (v2 transfer_ban_manager -> cGetTransferBans)")
local ok_tb, TBM = pcall(require, 'imports/core/managers/transfer_ban_manager')
if ok_tb and TBM then
    local mgr = TBM:new()
    local ok_b, bans = pcall(function() return mgr:GetAllBans() end)
    if ok_b and type(bans) == "table" then
        log("  bans: " .. #bans)
        for i = 1, math.min(10, #bans) do log("    " .. row_line(bans[i])) end
        log("  (tip: add a test ban to some CPU team in Team Editor first, so a row shows up)")
    else
        log("  GetAllBans error: " .. tostring(bans))
    end
else
    log("  transfer_ban_manager not loadable: " .. tostring(TBM))
end

-- ------------------------------------------------------------
section("5. SQUAD: transfer-listed / loan-listed / loaned-out / pre-signed")
local tpl = LE.db:GetTable("teamplayerlinks")
local squad = {}
if tpl then
    walk(tpl, 40000, function(rec)
        if v(tpl, rec, "teamid") == user_team then squad[#squad + 1] = v(tpl, rec, "playerid") end
    end)
end
local loans = LE.db:GetTable("playerloans")
if loans then
    walk(loans, 5000, function(rec)
        if v(loans, rec, "teamidloanedfrom") == user_team then squad[#squad + 1] = v(loans, rec, "playerid") end
    end)
end
local function call(fname, ...)
    local f = _G[fname]
    if type(f) ~= "function" then return "n/a" end
    local ok, r = pcall(f, ...)
    return ok and tostring(r) or ("ERROR " .. tostring(r))
end
log("  player                      transferListed loanListed loanedOut presigned")
local any = 0
for _, pid in ipairs(squad) do
    local tl, ll = call("IsPlayerTransferListed", pid, user_team), call("IsPlayerLoanListed", pid, user_team)
    local lo, ps = call("IsPlayerLoanedOut", pid), call("IsPlayerPresigned", pid)
    local name = (pcall(GetPlayerName, pid) and GetPlayerName(pid)) or tostring(pid)
    log(string.format("  %-27s %14s %10s %9s %9s", name, tl, ll, lo, ps))
    any = any + 1
end
log("  (" .. any .. " players; transfer-list one player first so a 'true' shows up)")

section("DONE")
log("No raw memory was read and nothing was written. Send the whole file back to Claude: " .. out_path)
flush_report()
print("FC27 standings sources report written to " .. out_path)
