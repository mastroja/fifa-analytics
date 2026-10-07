-- ============================================================
-- FC 27 FCEDataManager LIST FINDER — stage 4.
--
-- FC 26's bundled export_fixtures.lua shows how fixtures and standings are
-- stored: FCEDataManager holds pointers to generic list objects; each list
-- has an item COUNT at +0x1C and an items-BEGIN pointer at +0x28, with fixed
-- size items (0x18 bytes for both fixtures and standings, team id at +0x04
-- of a standings item). FC 27 moved the lists (the FC 26 offsets +0x60 /
-- +0x88 return garbage), but the list-object layout is probably the same.
-- The old GetPlayersStats() rows (teamid, playerid, compobjid, goals, ...)
-- were very likely another such list on the same manager.
--
-- This script finds those lists BY VALUE, not by assumed offset:
--   1. gets FCEDataManager exactly as export_all.lua does;
--   2. reads the manager's own first 0x300 bytes (own memory only);
--   3. for every pointer inside the heap arena 0x66000000..0x6B000000
--      (strict filter, as in stages 2-3): reads count@+0x1C and begin@+0x28,
--      and accepts it as a list if count is 1..200000 and begin is also in
--      the arena;
--   4. scans the first LIST_ITEMS_SCAN items (24..max stride-agnostic: every
--      u32 of the first 0x2000 bytes) for u32 values equal to any team id
--      from the user's league (leagueteamlinks, 24 teams) or any squad
--      player id (cm_teamsheets, + Breese 460043, Watkins 460044);
--   5. dumps the first 3 items (0x30 bytes each) and the context around the
--      first hit of each kind, so field layout can be matched to known values:
--        Breese  10 app / 2 goals / 2 assists / 6.49 avg (stored sum ~649?)
--        Watkins  9 app / 3 goals / 0 assists / 5.78 avg
--
-- Also tallies career_playermatchratinghistory per squad player at the end.
--
-- Run via Live Editor's Lua Engine (NOT bound to F10), same career/state.
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_find_fce_lists.txt
-- Flushed after every list, so a crash shows the last read.
-- ============================================================

require 'imports/other/helpers'
MEMORY = require 'imports/core/memory'
require 'imports/career_mode/enums'
require 'imports/career_mode/helpers'
require 'imports/services/enums'

local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_find_fce_lists.txt"
local report = {}
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end
local function log(line) table.insert(report, line) end

local ARENA_LO, ARENA_HI = 0x66000000, 0x6B000000
local MGR_BYTES = 0x300
local SCAN_BYTES = 0x2000
local MAX_COUNT = 200000
local function in_arena(v) return v and v >= ARENA_LO and v < ARENA_HI and (v % 8 == 0) end

local function qread(addr)
    local ok, v = pcall(MEMORY.ReadQword, MEMORY, addr)
    if ok then return v end
    return nil
end
local function iread(addr)
    local ok, v = pcall(MEMORY.ReadInt, MEMORY, addr)
    if ok then return v end
    return nil
end

-- ids to look for -------------------------------------------------------
local team_ids, team_count = {}, 0
local squad_ids, squad_count = { [460043] = true, [460044] = true }, 0
do
    local ok, user_team = pcall(GetUserTeamID)
    if ok and user_team then team_ids[user_team] = true; team_count = 1 end

    local lt = LE and LE.db and LE.db:GetTable("leagueteamlinks")
    if lt and lt.fields and user_team then
        local user_league
        local rec, n = lt:GetFirstRecord(), 0
        while rec and rec > 0 and n < 2000 do
            n = n + 1
            if lt:GetRecordFieldValue(rec, "teamid") == user_team then
                user_league = lt:GetRecordFieldValue(rec, "leagueid"); break
            end
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

    local ts = LE and LE.db and LE.db:GetTable("cm_teamsheets")
    if ok and user_team and ts and ts.fields then
        local rec, n = ts:GetFirstRecord(), 0
        while rec and rec > 0 and n < 10 do
            n = n + 1
            if ts:GetRecordFieldValue(rec, "teamid") == user_team then
                for i = 0, 51 do
                    local pid = ts:GetRecordFieldValue(rec, "playerid" .. i)
                    if pid and pid > 0 then squad_ids[pid] = true; squad_count = squad_count + 1 end
                end
                break
            end
            rec = ts:GetNextValidRecord()
        end
    end
end

-- FCEDataManager exactly as export_all.lua gets it ------------------------
local function GetFCEDataManager()
    local IFCEInterface = GetPlugin(ENUM_djb2IFCEInterface_CLSS)
    return MEMORY:ReadMultilevelPointer(IFCEInterface, {0x18, 0x10, 0x08, 0x00})
end

local function dump_rows(addr, nbytes, indent, mark_off, mark_text)
    for off = 0, nbytes - 8, 8 do
        local v = qread(addr + off)
        if v == nil then log(indent .. "read error"); return end
        local lo, hi = v & 0xFFFFFFFF, (v >> 32) & 0xFFFFFFFF
        log(string.format("%s+0x%03X  %08X %08X   lo=%-10d hi=%-10d%s", indent, off, hi, lo, lo, hi,
            (mark_off == off) and ("  <== " .. mark_text) or ""))
    end
end

local function scan_list(label, p, count, begin)
    log("")
    log(string.format("---- %s: list obj 0x%X count=%d begin=0x%X ----", label, p, count, begin))
    flush_report()

    local team_hits, squad_hits = {}, {}
    for off = 0, SCAN_BYTES - 4, 4 do
        local v = iread(begin + off)
        if v == nil then log("  read error at +0x" .. string.format("%X", off) .. ", stopping scan"); break end
        if team_ids[v] and #team_hits < 12 then team_hits[#team_hits + 1] = { off = off, id = v } end
        if squad_ids[v] and #squad_hits < 12 then squad_hits[#squad_hits + 1] = { off = off, id = v } end
    end

    log(string.format("  team-id hits in first 0x%X bytes: %d, squad-id hits: %d", SCAN_BYTES, #team_hits, #squad_hits))
    local function show(name, hits)
        if #hits == 0 then return end
        local t = {}
        for i, h in ipairs(hits) do t[#t + 1] = string.format("+0x%X(id=%d)", h.off, h.id) end
        log("  " .. name .. " hit offsets: " .. table.concat(t, ", "))
        if #hits >= 2 then
            local d = {}
            for i = 2, math.min(#hits, 8) do d[#d + 1] = string.format("0x%X", hits[i].off - hits[i - 1].off) end
            log("  " .. name .. " deltas (stride hint): " .. table.concat(d, ", "))
        end
    end
    show("team", team_hits)
    show("squad", squad_hits)

    log("  first 3 items (0x30 bytes each from begin):")
    dump_rows(begin, 0x90, "    ")

    for _, kind in ipairs({ { "team", team_hits }, { "squad", squad_hits } }) do
        local hits = kind[2]
        if #hits > 0 then
            local start = (hits[1].off // 8) * 8
            start = math.max(0, start - 0x18)
            log(string.format("  context around first %s hit (list+0x%X):", kind[1], start))
            dump_rows(begin + start, 0x60, "    ", hits[1].off - start - (hits[1].off % 8), kind[1] .. " id")
        end
    end
    flush_report()
end

log("FC27 FCEDataManager list finder, stage 4")
local dok, d = pcall(GetCurrentDate)
if dok and d then log(string.format("GetCurrentDate(): %04d-%02d-%02d", d.year, d.month, d.day)) end
log(string.format("league team ids loaded: %d, squad ids loaded: %d", team_count, squad_count))
flush_report()

local ok, mgr = pcall(GetFCEDataManager)
if not ok or not mgr or mgr == 0 then
    log("GetFCEDataManager failed: " .. tostring(mgr))
    flush_report()
    return
end
log(string.format("FCEDataManager @ 0x%X", mgr))
flush_report()

local ptrs, seen = {}, {}
for off = 0, MGR_BYTES - 8, 8 do
    local v = qread(mgr + off)
    if in_arena(v) and v ~= mgr and not seen[v] then
        seen[v] = true
        ptrs[#ptrs + 1] = { off = off, addr = v }
    end
end
log("arena pointers inside the manager: " .. #ptrs)
flush_report()

local found = 0
for _, p in ipairs(ptrs) do
    local count = iread(p.addr + 0x1C)
    local begin = qread(p.addr + 0x28)
    if count and count >= 1 and count <= MAX_COUNT and in_arena(begin) then
        found = found + 1
        local sok, err = pcall(scan_list, string.format("mgr+0x%X", p.off), p.addr, count, begin)
        if not sok then log("  scan error: " .. tostring(err)); flush_report() end
    end
end
log("")
log("list-shaped objects found (count@+0x1C, begin@+0x28): " .. found)

-- ------------------------------------------------------------
-- DB cross-check: career_playermatchratinghistory (live per-match rows:
-- artificialkey, date, minsplayed, playerid, position, rating). Tallies
-- rows / minutes / rating per squad player so apps + average rating can be
-- compared against the in-game numbers (Breese 10 apps 6.49, Watkins 9 apps
-- 5.78). Plain table read of fields confirmed in the schema report.
-- ------------------------------------------------------------
log("")
log("==================== career_playermatchratinghistory tally ====================")
flush_report()
do
    local t = LE and LE.db and LE.db:GetTable("career_playermatchratinghistory")
    if not t or not t.fields then
        log("table missing")
    else
        log("records=" .. tostring(t.written_records))
        local tally, order = {}, {}
        local rec, n = t:GetFirstRecord(), 0
        while rec and rec > 0 and n < 60000 do
            n = n + 1
            local pid = t:GetRecordFieldValue(rec, "playerid")
            if pid and squad_ids[pid] then
                local row = tally[pid]
                if not row then row = { rows = 0, mins = 0, rsum = 0, last = {} }; tally[pid] = row; order[#order + 1] = pid end
                local rating = t:GetRecordFieldValue(rec, "rating") or 0
                local mins = t:GetRecordFieldValue(rec, "minsplayed") or 0
                row.rows = row.rows + 1
                row.mins = row.mins + mins
                row.rsum = row.rsum + rating
                row.last[#row.last + 1] = string.format("%s:%s:%s", tostring(t:GetRecordFieldValue(rec, "date")), tostring(mins), tostring(rating))
                if #row.last > 4 then table.remove(row.last, 1) end
            end
            rec = t:GetNextValidRecord()
        end
        log("records walked: " .. n)
        table.sort(order)
        for _, pid in ipairs(order) do
            local r = tally[pid]
            log(string.format("  player %d: rows=%d minutes=%d rating_sum=%s avg_raw=%.3f  last (date:mins:rating): %s",
                pid, r.rows, r.mins, tostring(r.rsum), r.rows > 0 and (r.rsum / r.rows) or 0, table.concat(r.last, " | ")))
        end
    end
end
flush_report()

log("")
log("==================== DONE ====================")
log("Send this file back to Claude: " .. out_path)
flush_report()
print("FC27 FCEDataManager list finder written to " .. out_path)
