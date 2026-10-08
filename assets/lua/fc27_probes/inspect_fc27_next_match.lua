-- ============================================================
-- FC 27 NEXT-MATCH / RESULTS STRUCT DUMPER — stage 7 of the standings / fixtures hunt.
--
-- Stage 6 (inspect_fc27_find_standings.lua) scanned the big manager pools in full and found NO run of YYYYMMDD
-- dates at a 0x18 stride (fixtures) and no standings list; its one "standings" hit was a team-id-sorted array of
-- (team id, ~62) pairs, i.e. team ratings. So either the fixture date is not stored as YYYYMMDD in FC 27, or the
-- fixtures / standings live in a structure the pool scan did not cover.
--
-- A different angle: the game must know the NEXT fixture and the recent results of the user's team. The managers
-- that hold that (NextMatchManager, SimResultsManager, InterestingResultManager, ...) are small objects, so we can
-- dump them whole and follow their pointers a level or two. Every 32-bit value is tagged:
--   TEAM          a team id of the user's league (leagueteamlinks)
--   YMD           a valid YYYYMMDD date within a year of the save date
--   DAYS1582      a day offset from 1582-10-15 within 400 days of the save date (the encoding players.* dates use)
--   DAYS2000/1900 day offsets from 2000-01-01 / 1900-01-01 within 400 days of the save date
-- A struct with TWO team ids (home, away) next to a date tag is a fixture; its address and the pointer chain that
-- leads to it show where the fixture list lives, and the date tag tells us the encoding.
--
-- Reads are limited to: the manager object itself (as in stage 3), pointers inside the heap arena
-- 0x66000000..0x6B000000, and pointers within 0x30000000 of the manager object; nothing else is dereferenced.
-- Report is flushed after every struct, so a crash leaves the last read on disk.
--
-- Run via Live Editor's Lua Engine (NOT bound to F10): paste this WHOLE file into the code box, in a career save.
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_next_match.txt
-- ============================================================

require 'imports/other/helpers'
MEMORY = require 'imports/core/memory'
require 'imports/career_mode/enums'
require 'imports/career_mode/helpers'
require 'imports/services/enums'

local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_next_match.txt"
local report = {}
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end
local function log(line) table.insert(report, line) end

local ARENA_LO, ARENA_HI = 0x66000000, 0x6B000000
local OBJ_BYTES = 0x2C8
local CHILD_BYTES = 0x80
local GRANDCHILD_BYTES = 0x60
local MAX_CHILDREN = 24
local MAX_GRANDCHILDREN = 8
local READ_BUDGET = 400000
local reads_used = 0

local function qread(addr)
    reads_used = reads_used + 1
    local ok, v = pcall(MEMORY.ReadQword, MEMORY, addr)
    if ok then return v end
    return nil
end

-- save date and the encodings of "today" ---------------------------------------------------------------
local y, m, d = 2026, 9, 1
do
    local ok, cd = pcall(GetCurrentDate)
    if ok and cd and cd.year then y, m, d = cd.year, cd.month, cd.day end
end
local today_ymd = y * 10000 + m * 100 + d
local noon = os.time({ year = y, month = m, day = d, hour = 12 })
local today_1582 = math.floor((noon + 12219292800) / 86400)
local today_2000 = math.floor((noon - 946684800) / 86400)
local today_1900 = math.floor((noon + 2208988800) / 86400)
local WINDOW = 400

local function ymd_ok(v)
    if v < (y - 1) * 10000 + 101 or v > (y + 1) * 10000 + 1231 then return false end
    local mm, dd = (v // 100) % 100, v % 100
    return mm >= 1 and mm <= 12 and dd >= 1 and dd <= 31
end

-- league team ids -----------------------------------------------------------------------------------------
local team_ids, team_count = {}, 0
do
    local ok, team = pcall(GetUserTeamID)
    local lt = LE and LE.db and LE.db:GetTable("leagueteamlinks")
    if ok and team then team_ids[team] = true; team_count = 1 end
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
                    if tid and tid > 0 and not team_ids[tid] then team_ids[tid] = true; team_count = team_count + 1 end
                end
                rec = lt:GetNextValidRecord()
            end
        end
    end
end

local function tag32(v)
    local t = {}
    if team_ids[v] then t[#t + 1] = "TEAM" end
    if ymd_ok(v) then t[#t + 1] = "YMD" end
    if math.abs(v - today_1582) <= WINDOW then t[#t + 1] = "DAYS1582" end
    if math.abs(v - today_2000) <= WINDOW then t[#t + 1] = "DAYS2000" end
    if math.abs(v - today_1900) <= WINDOW then t[#t + 1] = "DAYS1900" end
    return t
end

local function pointer_ok(p, obj)
    if p == nil or p <= 0x10000 or p % 8 ~= 0 or p == obj then return false end
    if p >= ARENA_LO and p < ARENA_HI then return true end
    return math.abs(p - obj) < 0x30000000
end

-- Dump nbytes at addr, one qword per line, tagging team ids / dates. Returns the pointers found and whether any
-- TEAM / date tag was seen.
local function dump_struct(label, addr, nbytes, obj)
    log("")
    log(string.format("---- %s @ 0x%X (%d bytes) ----", label, addr, nbytes))
    local ptrs, tagged = {}, false
    local team_hits, date_hits = 0, 0
    for off = 0, nbytes - 8, 8 do
        if reads_used >= READ_BUDGET then log("  !! read budget exhausted"); break end
        local v = qread(addr + off)
        if v == nil then log(string.format("  read error at +0x%X, stopping this struct", off)); break end
        if v ~= 0 then
            local lo, hi = v & 0xFFFFFFFF, (v >> 32) & 0xFFFFFFFF
            local tl, th = tag32(lo), tag32(hi)
            local notes = {}
            if #tl > 0 then notes[#notes + 1] = "lo:" .. table.concat(tl, "/") end
            if #th > 0 then notes[#notes + 1] = "hi:" .. table.concat(th, "/") end
            for _, tg in ipairs(tl) do if tg == "TEAM" then team_hits = team_hits + 1 else date_hits = date_hits + 1 end end
            for _, tg in ipairs(th) do if tg == "TEAM" then team_hits = team_hits + 1 else date_hits = date_hits + 1 end end
            if pointer_ok(v, obj) then
                ptrs[#ptrs + 1] = { off = off, addr = v }
                notes[#notes + 1] = "ptr"
            end
            log(string.format("  +0x%03X  %08X %08X   lo=%-10d hi=%-10d  %s", off, hi, lo, lo, hi, table.concat(notes, " ")))
        end
    end
    tagged = (team_hits > 0) or (date_hits > 0)
    log(string.format("  [%d team-id tags, %d date tags, %d pointers]", team_hits, date_hits, #ptrs))
    flush_report()
    return ptrs, tagged, team_hits, date_hits
end

local function probe_manager(label, type_id)
    log("")
    log("==================================================================")
    log(label .. " (type id " .. tostring(type_id) .. ")")
    log("==================================================================")
    flush_report()
    if type(type_id) ~= "number" then log("enum not defined"); flush_report(); return end
    local ok, obj = pcall(GetManagerObjByTypeId, type_id)
    if not ok or not obj or obj == 0 then log("no instance"); flush_report(); return end

    local ptrs = dump_struct(label .. " object", obj, OBJ_BYTES, obj)
    local seen = { [obj] = true }
    local n = 0
    for _, p in ipairs(ptrs) do
        if n >= MAX_CHILDREN then log("(more child pointers skipped, cap " .. MAX_CHILDREN .. ")"); break end
        if not seen[p.addr] then
            seen[p.addr] = true
            n = n + 1
            local cptrs, tagged, th, dh = dump_struct(string.format("%s obj+0x%X ->", label, p.off), p.addr, CHILD_BYTES, obj)
            -- a child that already holds team ids or dates is worth one more level
            if tagged and (th > 0 or dh > 0) then
                local g = 0
                for _, cp in ipairs(cptrs) do
                    if g >= MAX_GRANDCHILDREN then break end
                    if not seen[cp.addr] then
                        seen[cp.addr] = true
                        g = g + 1
                        dump_struct(string.format("%s obj+0x%X -> +0x%X ->", label, p.off, cp.off), cp.addr, GRANDCHILD_BYTES, obj)
                    end
                end
            end
        end
    end
end

log("FC27 next-match / results struct dumper, stage 7")
log(string.format("save date %04d-%02d-%02d  YMD=%d  days1582=%d days2000=%d days1900=%d", y, m, d, today_ymd, today_1582, today_2000, today_1900))
log("league team ids loaded: " .. team_count)
flush_report()

local TARGETS = {
    { "NextMatchManager", "NextMatchManager" },
    { "SimResultsManager", "SimResultsManager" },
    { "InterestingResultManager", "InterestingResultManager" },
    { "StandingsViewManager", "StandingsViewManager" },
    { "ActiveCompetitionsManager", "ActiveCompetitionsManager" },
    { "SeasonSituationSystem", "SeasonSituationSystem" },
    { "FixtureManager", "FixtureManager" },
}
for _, t in ipairs(TARGETS) do
    probe_manager(t[1], _G["ENUM_FCEGameModesFCECareerMode" .. t[2]])
end

log("")
log("==================== DONE ====================")
log("Qword reads used: " .. reads_used)
log("Send this file back to Claude: " .. out_path)
flush_report()
print("FC27 next-match struct dumper written to " .. out_path)
