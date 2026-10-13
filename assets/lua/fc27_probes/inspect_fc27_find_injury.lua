-- ============================================================
-- FC 27 INJURY FINDER — stage 8 of the memory hunt (read-only, NOT for F10).
--
-- teamplayerlinks.injury is 0 for every player league-wide in FC27, so the
-- live injury state is somewhere else. The game raises "player injured" inbox
-- messages (CM_EVENT_MSG_INJURY = 165), so the message / news / events
-- managers are the best remaining leads. Same safe approach as stage 3
-- (arena-bounded eastl vector scan, capped reads, flushed after every vector)
-- but pointed at those managers and at ONE target player.
--
-- Target: Malik Kane, playerid 460012 (sprained ankle, out ~2 weeks). Run it
-- WHILE he is injured in game. Hits for his id are tagged "<== KANE" and the
-- context dump around each Kane hit is what we want to read (injury type id /
-- days remaining should sit near his id). Other squad ids are still reported
-- as a control, so a vector full of squad ids is a per-player table.
--
-- Run via Live Editor's Lua Engine (NOT bound to F10), in the same career.
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_find_injury.txt
-- ============================================================

require 'imports/other/helpers'
MEMORY = require 'imports/core/memory'
require 'imports/career_mode/enums'
require 'imports/career_mode/helpers'
require 'imports/services/enums'

local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_find_injury.txt"
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
local MAX_HITS_PER_VEC = 400
local TOTAL_READ_BUDGET = 2500000   -- qword reads across the whole run
local reads_used = 0

local function in_arena(v)
    return v and v >= ARENA_LO and v < ARENA_HI and (v % 8 == 0)
end

local MANAGERS = {
    { "NewsManager", ENUM_FCEGameModesFCECareerModeNewsManager },
    { "EventsManager", ENUM_FCEGameModesFCECareerModeEventsManager },
    { "UnexpectedEventsManager", ENUM_FCEGameModesFCECareerModeUnexpectedEventsManager },
    { "PersistentEventsManager", ENUM_FCEGameModesFCECareerModePersistentEventsManager },
    { "PlayerStatusManager", ENUM_FCEGameModesFCECareerModePlayerStatusManager },
    { "FitnessManager", ENUM_FCEGameModesFCECareerModeFitnessManager },
}

-- squad ids from cm_teamsheets + the two known test players
local KANE = 460012
local squad_ids = { [KANE] = true }
local squad_count = 0
do
    local ok, team = pcall(GetUserTeamID)
    local ts = LE and LE.db and LE.db:GetTable("cm_teamsheets")
    if ok and team and ts and ts.fields then
        local rec, n = ts:GetFirstRecord(), 0
        while rec and rec > 0 and n < 10 do
            n = n + 1
            if ts:GetRecordFieldValue(rec, "teamid") == team then
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
        log("    no squad-id hits")
        flush_report()
        return
    end

    log(string.format("    *** %d hits, %d distinct squad ids ***", #hits, ndistinct))
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
    -- dump the first control hit plus up to 4 Kane hits (wider window: 0x80)
    local dump = {}
    for i = 1, #hits do
        if hits[i].id == KANE then
            if #dump < 5 then dump[#dump + 1] = i end
        elseif not dump.ctrl then dump.ctrl = true; table.insert(dump, 1, i) end
    end
    for _, i in ipairs(dump) do
        local start = math.max(0, hits[i].off - 0x10)
        log(string.format("    context around hit %d (vector+0x%X), each row = one qword (hi lo):", i, start))
        for off = start, start + 0x80 - 8, 8 do
            local v = qread(b + off)
            if v == nil then log("      read error"); break end
            local lo, hi = v & 0xFFFFFFFF, (v >> 32) & 0xFFFFFFFF
            local mark = ""
            if off == hits[i].off then mark = (hits[i].id == KANE) and "  <== KANE" or "  <== squad id" end
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
    if not ok or not obj or obj == 0 then log("no instance"); flush_report(); return end
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

log("FC27 injury finder, stage 8")
local dok, d = pcall(GetCurrentDate)
if dok and d then log(string.format("GetCurrentDate(): %04d-%02d-%02d", d.year, d.month, d.day)) end
log("Squad ids loaded: " .. squad_count .. " (+ Kane " .. KANE .. ")")
flush_report()

for _, m in ipairs(MANAGERS) do scan_manager(m[1], m[2]) end

log("")
log("==================== DONE ====================")
log("Qword reads used: " .. reads_used)
log("Send this file back to Claude: " .. out_path)
flush_report()
print("FC27 injury finder written to " .. out_path)
