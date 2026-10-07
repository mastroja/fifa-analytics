-- ============================================================
-- FC 27 SEASON-STATS + DYNAMIC-OVERALL MEMORY SCAN — STAGE 2.
--
-- Stage 1 (inspect_fc27_stats_memory.lua) dumped each manager object's own
-- bytes. This stage follows the pointers found inside them ONE level deep,
-- under a strict filter:
--   * the target must lie in the heap arena where the live manager objects
--     sit (0x66000000 .. 0x6B000000, 8-byte aligned). Stage 1 showed
--     floats/ints (e.g. 0x41A00000 = 20.0f) that merely LOOK like pointers;
--     none of them fall in this window, so they are never dereferenced.
--   * capped at MAX_PTRS targets per manager, 0x80 bytes each.
--   * if a target begins with an eastl-style vector triple
--     (begin <= end <= capacity, all in the arena, <= 16MB), the first
--     0xC0 bytes at `begin` are dumped too (depth 2, same filter).
--
-- Every dumped 8-byte unit is shown as two u32 halves plus a float view,
-- and any u32 equal to a player id on the user's squad sheet
-- (cm_teamsheets) is flagged "<== SQUAD ID". A per-player stats record
-- must contain its player id, so hits mark the real stats storage.
--
-- Run via Live Editor's Lua Engine (NOT bound to F10), in the same career
-- save/state you ran stage 1 in.
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_stats_memory_stage2.txt
-- Flushed after every single block so a crash shows the last read.
-- ============================================================

require 'imports/other/helpers'
MEMORY = require 'imports/core/memory'
require 'imports/career_mode/enums'
require 'imports/career_mode/helpers'
require 'imports/services/enums'

local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_stats_memory_stage2.txt"
local report = {}
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end
local function log(line) table.insert(report, line) end

local ARENA_LO, ARENA_HI = 0x66000000, 0x6B000000
local SCAN_BYTES = 0x2C8         -- stay inside the objects (ProfileStats is smaller than 0x300)
local MAX_PTRS = 30
local TARGET_BYTES = 0x80
local VECTOR_BYTES = 0xC0

local function in_arena(v)
    return v and v >= ARENA_LO and v < ARENA_HI and (v % 8 == 0)
end

local function as_float(u)
    local ok, f = pcall(string.unpack, "<f", string.pack("<I4", u))
    if ok and f == f and math.abs(f) >= 0.001 and math.abs(f) <= 100000 then
        return string.format("%.3f", f)
    end
    return nil
end

-- user squad player ids (cm_teamsheets) for hit-flagging
local squad_ids = {}
local squad_count = 0
do
    local ok, team = pcall(GetUserTeamID)
    local ts = LE and LE.db and LE.db:GetTable("cm_teamsheets")
    if ok and team and ts and ts.fields then
        local rec = ts:GetFirstRecord()
        local n = 0
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

local hits_total = 0

-- Dump `nbytes` at `addr`; returns the qwords read (index by byte offset).
local function dump_block(addr, nbytes, indent)
    local q = {}
    for off = 0, nbytes - 8, 8 do
        local ok, v = pcall(MEMORY.ReadQword, MEMORY, addr + off)
        if not ok or v == nil then
            log(string.format("%s+0x%02X  READ ERROR", indent, off))
            break
        end
        q[off] = v
        local lo, hi = v & 0xFFFFFFFF, (v >> 32) & 0xFFFFFFFF
        local notes = {}
        local fl, fh = as_float(lo), as_float(hi)
        if fl then table.insert(notes, "lo=" .. fl .. "f") end
        if fh then table.insert(notes, "hi=" .. fh .. "f") end
        if squad_ids[lo] then table.insert(notes, "<== SQUAD ID " .. lo .. " (lo)"); hits_total = hits_total + 1 end
        if squad_ids[hi] then table.insert(notes, "<== SQUAD ID " .. hi .. " (hi)"); hits_total = hits_total + 1 end
        log(string.format("%s+0x%02X  %08X %08X   lo=%-10d hi=%-10d %s",
            indent, off, hi, lo, lo, hi, table.concat(notes, " ")))
    end
    flush_report()
    return q
end

local function scan_manager(label, type_id)
    log("")
    log("==================== " .. label .. " (type id " .. tostring(type_id) .. ") ====================")
    flush_report()

    local ok, obj = pcall(GetManagerObjByTypeId, type_id)
    if not ok or not obj or obj == 0 then
        log("no instance"); flush_report(); return
    end
    log(string.format("object @ 0x%X", obj))
    flush_report()

    -- gather candidate pointers from the object's own bytes
    local targets, seen = {}, {}
    for off = 0, SCAN_BYTES - 8, 8 do
        local rok, v = pcall(MEMORY.ReadQword, MEMORY, obj + off)
        if rok and in_arena(v) and v ~= obj and not seen[v] and #targets < MAX_PTRS then
            seen[v] = true
            table.insert(targets, { off = off, addr = v })
        end
    end
    log(string.format("arena pointers found in object: %d (cap %d)", #targets, MAX_PTRS))
    flush_report()

    for _, t in ipairs(targets) do
        log("")
        log(string.format("---- obj+0x%03X -> 0x%X ----", t.off, t.addr))
        flush_report()
        local q = dump_block(t.addr, TARGET_BYTES, "    ")

        -- vector triple at the start of the target?
        local b, e, c = q[0], q[8], q[16]
        if in_arena(b) and in_arena(e) and in_arena(c) and b <= e and e <= c and (c - b) <= 0x1000000 and e > b then
            log(string.format("    >> vector triple: begin=0x%X used=%d bytes cap=%d bytes; first elements:", b, e - b, c - b))
            flush_report()
            dump_block(b, math.min(VECTOR_BYTES, (e - b) // 8 * 8), "        ")
        end
    end
end

log("FC27 stats memory scan, stage 2")
local dok, d = pcall(GetCurrentDate)
if dok and d then log(string.format("GetCurrentDate(): %04d-%02d-%02d", d.year, d.month, d.day)) end
log("Squad ids loaded from cm_teamsheets: " .. squad_count)
flush_report()

scan_manager("SeasonStatsManager", ENUM_FCEGameModesFCECareerModeSeasonStatsManager)
scan_manager("ProfileStatsManager", ENUM_FCEGameModesFCECareerModeProfileStatsManager)
scan_manager("DynamicOverallManager", ENUM_FCEGameModesFCECareerModeDynamicOverallManager)

log("")
log("==================== DONE ====================")
log("Total squad-id hits flagged: " .. hits_total)
log("Send this file back to Claude: " .. out_path)
flush_report()
print("FC27 stats memory stage 2 written to " .. out_path)
