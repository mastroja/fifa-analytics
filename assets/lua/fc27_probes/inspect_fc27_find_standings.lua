-- ============================================================
-- FC 27 STANDINGS / FIXTURES FINDER — stage 6 (structure detector).
--
-- Stage 5 (the first version of this file) scanned the schedule-related managers for league team ids and found no
-- list: hits were scattered across big allocator pools (FCEDataObjectManager obj+0x188 / +0x1E8, NextMatchManager
-- obj+0x10, MatchImportanceManager +0x1C0->+0x8, 3.8-10 MB each) at irregular spacing, but FCEDataObjectManager
-- +0x1E8 did hold qwords with TWO team ids packed together (e.g. 1797|1807), which looks like home|away pairs.
--
-- This stage stops looking for single ids and detects the two lists by SHAPE, scanning each pool in full:
--   FIXTURES  (FC 26 item = 0x18 bytes): item+0x00 is mDate as a YYYYMMDD int. A fixture list therefore shows a run
--             of >= 8 values at a constant 0x18 stride that are all valid dates in the save's year +/- 1.
--   STANDINGS (FC 26 item = 0x18 bytes): item+0x04 is mTeamId. A standings list shows a run of >= 6 values at a
--             constant 0x18 stride that are team ids of the user's league (leagueteamlinks), >= 4 of them distinct.
-- Both are checked with the item start 8-aligned and 4-aligned. Each candidate run is reported with the address, its
-- offset inside the pool/manager path, and the decoded fields of its first items, so the layout can be confirmed
-- against known values (Man City's fixtures, standings points).
--
-- Reads stay inside vectors whose begin/end are both in the heap arena (same strict filter as stages 3-5), in chunks,
-- with a global read budget, flushing the report after every chunk, so a crash still leaves the last read on disk.
--
-- Run via Live Editor's Lua Engine (NOT bound to F10), in a career save, ideally a few matchdays in.
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_find_standings.txt   (this overwrites the stage 5 report)
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
local MAX_VEC_SCAN = 0x1800000      -- bytes scanned per vector (24 MB, enough for the big pools)
local MAX_VECS_PER_MANAGER = 12
local MAX_HITS_PER_VEC = 40
local CHUNK_QWORDS = 131072        -- 1 MB per chunk
local OVERLAP_QWORDS = 3 * 40      -- so a run straddling a chunk boundary is still seen
local MIN_DATE_RUN, MIN_TEAM_RUN = 8, 6
local MAX_CANDIDATES_PER_VEC = 12
local TOTAL_READ_BUDGET = 9000000   -- qword reads across the whole run
local reads_used = 0

local function in_arena(v)
    return v and v >= ARENA_LO and v < ARENA_HI and (v % 8 == 0)
end

-- looked up by enum NAME so a missing enum in some Live Editor version just skips that manager
local MANAGER_NAMES = {
    "FCEDataObjectManager", "NextMatchManager", "MatchImportanceManager", "StandingsViewManager", "FixtureManager",
    "ActiveCompetitionsManager", "CalendarManager", "SeasonSituationSystem", "SeasonStatsManager", "InterestingResultManager",
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

local today_year = 2026
do
    local ok, d = pcall(GetCurrentDate)
    if ok and d and d.year then today_year = d.year end
end
local DATE_LO, DATE_HI = (today_year - 1) * 10000 + 101, (today_year + 1) * 10000 + 1231
local function date_ok(v)
    if v < DATE_LO or v > DATE_HI then return false end
    local m, d = (v // 100) % 100, v % 100
    return m >= 1 and m <= 12 and d >= 1 and d <= 31
end
local function half_of(q, i, h)
    local v = q[i]
    if h == 0 then return v & 0xFFFFFFFF end
    return (v >> 32) & 0xFFFFFFFF
end

-- Detect fixture-shaped and standings-shaped runs inside one chunk of qwords q[0..n-1] (chunk start address cb).
local function detect_in_chunk(q, n, cb, path, found)
    for h = 0, 1 do
        -- fixtures: dates at constant 3-qword (0x18) stride
        local i = 0
        while i < n - 3 do
            if date_ok(half_of(q, i, h)) then
                local count, j = 1, i + 3
                while j < n and date_ok(half_of(q, j, h)) do count = count + 1; j = j + 3 end
                if count >= MIN_DATE_RUN and #found < MAX_CANDIDATES_PER_VEC then
                    found[#found + 1] = { kind = "FIXTURES", addr = cb + i * 8 + h * 4, count = count, path = path }
                end
                i = (count >= MIN_DATE_RUN) and j or (i + 1)
            else
                i = i + 1
            end
        end
        -- standings: league team ids at constant 3-qword stride
        i = 0
        while i < n - 3 do
            if squad_ids[half_of(q, i, h)] then
                local count, j, distinct, seen = 1, i + 3, 1, { [half_of(q, i, h)] = true }
                while j < n and squad_ids[half_of(q, j, h)] do
                    local id = half_of(q, j, h)
                    if not seen[id] then seen[id] = true; distinct = distinct + 1 end
                    count = count + 1; j = j + 3
                end
                if count >= MIN_TEAM_RUN and distinct >= 4 and #found < MAX_CANDIDATES_PER_VEC then
                    -- the team id sits at item+0x04, so the item starts 4 bytes before the id
                    found[#found + 1] = { kind = "STANDINGS", addr = cb + i * 8 + h * 4 - 4, count = count, distinct = distinct, path = path }
                end
                i = (count >= MIN_TEAM_RUN and distinct >= 4) and j or (i + 1)
            else
                i = i + 1
            end
        end
    end
end

-- Decode and log the first items of a candidate run (FC 26 field layout; compare against known values).
local function describe(c)
    log(string.format("    *** %s candidate at 0x%X (%s): run of %d%s ***", c.kind, c.addr, c.path, c.count,
        c.distinct and (", " .. c.distinct .. " distinct team ids") or ""))
    for k = 0, 5 do
        local a0 = c.addr + k * 0x18
        local w0, w1, w2 = qread(a0), qread(a0 + 8), qread(a0 + 16)
        if w0 == nil then log("      read error"); break end
        local function u32(w, hi) if hi then return (w >> 32) & 0xFFFFFFFF end return w & 0xFFFFFFFF end
        local function u16(w, sh) return (w >> sh) & 0xFFFF end
        if c.kind == "FIXTURES" then
            log(string.format("      item %d: date=%d comp=%d home=%d away=%d  raw %08X %08X | %08X %08X | %08X %08X", k,
                u32(w0, false), u16(w1, 0), u16(w1, 16), u16(w1, 32), u32(w0, true), u32(w0, false), u32(w1, true), u32(w1, false), u32(w2, true), u32(w2, false)))
        else
            log(string.format("      item %d: id=%d comp=%d team=%d idx=%d  raw %08X %08X | %08X %08X | %08X %08X", k,
                u16(w0, 0), u16(w0, 16), u32(w0, true), w1 & 0xFF, u32(w0, true), u32(w0, false), u32(w1, true), u32(w1, false), u32(w2, true), u32(w2, false)))
        end
    end
end

-- Scan [b, e) in chunks looking for the two list shapes.
local function scan_vector(b, e, path, obj)
    local span = e - b
    local scan = math.min(span, MAX_VEC_SCAN)
    log(string.format("  vector @ %s: begin=0x%X end=0x%X span=%d bytes (scanning %d)", path, b, e, span, scan))
    flush_report()

    local found = {}
    local pos = 0 -- qword index
    local total_q = scan // 8
    while pos < total_q do
        if reads_used >= TOTAL_READ_BUDGET then log("  !! global read budget exhausted"); break end
        local n = math.min(CHUNK_QWORDS, total_q - pos)
        local q, ok = {}, true
        for i = 0, n - 1 do
            local v = qread(b + (pos + i) * 8)
            if v == nil then ok = false; log(string.format("  read error at +0x%X, stopping this vector", (pos + i) * 8)); break end
            q[i] = v
        end
        if not ok then break end
        detect_in_chunk(q, n, b + pos * 8, path, found)
        if pos + n >= total_q then break end
        pos = pos + n - OVERLAP_QWORDS
    end

    if #found == 0 then
        log("    no fixture- or standings-shaped runs")
        flush_report()
        return
    end
    -- the overlap can report one run twice; drop exact duplicates
    local seen = {}
    for _, c in ipairs(found) do
        local key = c.kind .. ":" .. c.addr
        if not seen[key] then seen[key] = true; describe(c) end
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

log("FC27 standings/fixtures finder, stage 6 (structure detector)")
log(string.format("date window %d..%d, min runs: dates %d, teams %d", DATE_LO, DATE_HI, MIN_DATE_RUN, MIN_TEAM_RUN))
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
