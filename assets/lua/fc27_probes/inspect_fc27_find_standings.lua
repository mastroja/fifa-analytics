-- ============================================================
-- FC 27 STANDINGS / FIXTURES FINDER — stage 5.
--
-- Open problem: FC 26's live standings and fixtures sat in two lists on FCEDataManager (+0x88 standings,
-- +0x60 fixtures; items 0x18 bytes, team id at +0x04 of a standings item, fixture items hold a date,
-- competition object id and home/away STANDING indexes). In FC 27 those offsets return garbage and stage 4
-- (inspect_fc27_find_fce_lists.lua) found no list-shaped object under FCEDataManager at all. The DB tables
-- `fixtures` / `leagueteamlinks` are stale default data, so the live data is still in memory somewhere else.
--
-- This stage does what stage 3 did for player stats, but for the managers that plausibly own the schedule:
-- FixtureManager, StandingsViewManager, ActiveCompetitionsManager, CalendarManager, NextMatchManager,
-- SeasonSituationSystem, LeagueUtils, ... For each it finds eastl-style vector triples (same strict arena filter as
-- stage 3) and scans their contents for the team ids of the user's league (leagueteamlinks, ~24 teams). A real
-- standings list has MANY DIFFERENT team ids at a regular stride (FC 26: 0x18, team id at +0x04), so the
-- "deltas between consecutive hits" line is the tell. The context dump around the first hits is there to match
-- field layout (rank/points/played ... next to the team id).
--
-- Run via Live Editor's Lua Engine (NOT bound to F10), in a career save, ideally a few matchdays in.
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_find_standings.txt
-- Flushed after every vector scan, so a crash still leaves the last read on disk.
-- ============================================================

require 'imports/other/helpers'
MEMORY = require 'imports/core/memory'
require 'imports/career_mode/enums'
require 'imports/career_mode/helpers'
require 'imports/services/enums'

local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_find_standings.txt"
local report = {}
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end
local function log(line) table.insert(report, line) end

local ARENA_LO, ARENA_HI = 0x66000000, 0x6B000000
local OBJ_BYTES = 0x2C8
local MAX_PTRS = 30
local MAX_VEC_SCAN = 0x80000        -- bytes scanned per vector
local MAX_VECS_PER_MANAGER = 12
local MAX_HITS_PER_VEC = 40
local TOTAL_READ_BUDGET = 2500000   -- qword reads across the whole run
local reads_used = 0

local function in_arena(v)
    return v and v >= ARENA_LO and v < ARENA_HI and (v % 8 == 0)
end

-- looked up by enum NAME so a missing enum in some Live Editor version just skips that manager
local MANAGER_NAMES = {
    "FixtureManager", "StandingsViewManager", "ActiveCompetitionsManager", "CalendarManager", "NextMatchManager",
    "SeasonSituationSystem", "SeasonStatsManager", "InterestingResultManager", "MatchImportanceManager",
    "FCEDataObjectManager", "EndOfSeasonManager", "CompetitionObjectivesManager", "LeagueUtils", "FixtureUtils", "TeamUtils",
}
local MANAGERS = {}
for _, n in ipairs(MANAGER_NAMES) do
    MANAGERS[#MANAGERS + 1] = { n, _G["ENUM_FCEGameModesFCECareerMode" .. n] }
end

-- team ids of the user's league (a standings list contains exactly these), plus the user's own team
local squad_ids = {}
local squad_count = 0
do
    local ok, team = pcall(GetUserTeamID)
    local lt = LE and LE.db and LE.db:GetTable("leagueteamlinks")
    if ok and team then squad_ids[team] = true; squad_count = 1 end
    if ok and team and lt and lt.fields then
        local user_league
        local rec, n = lt:GetFirstRecord(), 0
        while rec and rec > 0 and n < 2000 do
            n = n + 1
            if lt:GetRecordFieldValue(rec, "teamid") == team then user_league = lt:GetRecordFieldValue(rec, "leagueid"); break end
            rec = lt:GetNextValidRecord()
        end
        if user_league then
            rec, n = lt:GetFirstRecord(), 0
            while rec and rec > 0 and n < 2000 do
                n = n + 1
                if lt:GetRecordFieldValue(rec, "leagueid") == user_league then
                    local tid = lt:GetRecordFieldValue(rec, "teamid")
                    if tid and tid > 0 and not squad_ids[tid] then squad_ids[tid] = true; squad_count = squad_count + 1 end
                end
                rec = lt:GetNextValidRecord()
            end
        end
    end
end

local function qread(addr)
    reads_used = reads_used + 1
    local ok, v = pcall(MEMORY.ReadQword, MEMORY, addr)
    if ok then return v end
    return nil
end

-- Scan [b, e) for squad ids; returns hits list and distinct-id count.
local function scan_vector(b, e, path, obj)
    local span = e - b
    local scan = math.min(span, MAX_VEC_SCAN)
    log(string.format("  vector @ %s: begin=0x%X end=0x%X span=%d bytes (scanning %d)", path, b, e, span, scan))
    flush_report()

    local hits, distinct, ndistinct = {}, {}, 0
    for off = 0, scan - 8, 8 do
        if reads_used >= TOTAL_READ_BUDGET then log("  !! global read budget exhausted"); break end
        local v = qread(b + off)
        if v == nil then log(string.format("  read error at +0x%X, stopping this vector", off)); break end
        local lo, hi = v & 0xFFFFFFFF, (v >> 32) & 0xFFFFFFFF
        local hit_id, half = nil, nil
        if squad_ids[lo] then hit_id, half = lo, "lo" elseif squad_ids[hi] then hit_id, half = hi, "hi" end
        if hit_id then
            table.insert(hits, { off = off, id = hit_id, half = half })
            if not distinct[hit_id] then distinct[hit_id] = true; ndistinct = ndistinct + 1 end
            if #hits >= MAX_HITS_PER_VEC then break end
        end
    end

    if #hits == 0 then
        log("    no team-id hits")
        flush_report()
        return
    end

    log(string.format("    *** %d hits, %d distinct team ids ***", #hits, ndistinct))
    local offs = {}
    for i = 1, math.min(#hits, 14) do
        offs[#offs + 1] = string.format("+0x%X(%s id=%d)", hits[i].off, hits[i].half, hits[i].id)
    end
    log("    hit offsets: " .. table.concat(offs, ", "))
    if #hits >= 2 then
        local deltas = {}
        for i = 2, math.min(#hits, 10) do deltas[#deltas + 1] = string.format("0x%X", hits[i].off - hits[i - 1].off) end
        log("    deltas between consecutive hits (stride hint): " .. table.concat(deltas, ", "))
    end

    -- context dump around the first two hits (record start guess = hit - 0x10)
    for i = 1, math.min(#hits, 2) do
        local start = math.max(0, hits[i].off - 0x10)
        log(string.format("    context around hit %d (vector+0x%X), each row = one qword (hi lo):", i, start))
        for off = start, start + 0x60 - 8, 8 do
            local v = qread(b + off)
            if v == nil then log("      read error"); break end
            local lo, hi = v & 0xFFFFFFFF, (v >> 32) & 0xFFFFFFFF
            local mark = ""
            if off == hits[i].off then mark = "  <== team id" end
            log(string.format("      +0x%03X  %08X %08X   lo=%-10d hi=%-10d%s", off, hi, lo, lo, hi, mark))
        end
    end
    flush_report()
end

local function collect_triples(qwords, maxoff, obj, path, out)
    for off = 0, maxoff - 16, 8 do
        local b, e, c = qwords[off], qwords[off + 8], qwords[off + 16]
        if in_arena(b) and in_arena(e) and in_arena(c) and b < e and e <= c
            and (e - b) >= 8 and (e - b) <= 0x1000000 and (e - b) % 4 == 0
            and not (obj >= b and obj <= c) then
            table.insert(out, { b = b, e = e, path = string.format("%s+0x%X", path, off) })
        end
    end
end

local function scan_manager(label, type_id)
    log("")
    log("==================== " .. label .. " (type id " .. tostring(type_id) .. ") ====================")
    flush_report()
    if type(type_id) ~= "number" then log("enum not defined"); return end

    local ok, obj = pcall(GetManagerObjByTypeId, type_id)
    if not ok or not obj or obj == 0 then log("no instance (manager not created in this career state)"); flush_report(); return end
    log(string.format("object @ 0x%X", obj))

    local q = {}
    for off = 0, OBJ_BYTES - 8, 8 do q[off] = qread(obj + off) end

    local triples = {}
    collect_triples(q, OBJ_BYTES, obj, "obj", triples)

    -- depth 1: first 0x40 bytes of each arena pointer target
    local ptrs, seen = {}, {}
    for off = 0, OBJ_BYTES - 8, 8 do
        local v = q[off]
        if in_arena(v) and v ~= obj and not seen[v] and #ptrs < MAX_PTRS then
            seen[v] = true
            ptrs[#ptrs + 1] = { off = off, addr = v }
        end
    end
    for _, p in ipairs(ptrs) do
        local tq = {}
        for off = 0, 0x40 - 8, 8 do tq[off] = qread(p.addr + off) end
        collect_triples(tq, 0x40, obj, string.format("obj+0x%X->0x%X", p.off, p.addr), triples)
    end
    log(string.format("arena pointers: %d, candidate vectors: %d", #ptrs, #triples))
    flush_report()

    for i, t in ipairs(triples) do
        if i > MAX_VECS_PER_MANAGER then log("  (more candidate vectors skipped, cap " .. MAX_VECS_PER_MANAGER .. ")"); break end
        local sok, err = pcall(scan_vector, t.b, t.e, t.path, obj)
        if not sok then log("  scan error: " .. tostring(err)); flush_report() end
    end
end

log("FC27 standings/fixtures finder, stage 5")
local dok, d = pcall(GetCurrentDate)
if dok and d then log(string.format("GetCurrentDate(): %04d-%02d-%02d", d.year, d.month, d.day)) end
log("League team ids loaded: " .. squad_count)
flush_report()

for _, m in ipairs(MANAGERS) do scan_manager(m[1], m[2]) end

log("")
log("==================== DONE ====================")
log("Qword reads used: " .. reads_used)
log("Send this file back to Claude: " .. out_path)
flush_report()
print("FC27 standings/fixtures finder written to " .. out_path)
