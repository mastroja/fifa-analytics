-- ============================================================
-- FC 27 SEASON-STATS + DYNAMIC-OVERALL MEMORY SCAN — STAGE 1 (layout only).
--
-- Goal: find where current-season player stats (goals, assists, apps,
-- cards, clean sheets, avg rating) live, since FC 27's Live Editor has
-- no GetPlayersStats(). In FC 26 that native function walked the
-- Career Mode SeasonStatsManager; FC 27's own enum ids for the stats
-- managers are in lua/libs/v2/imports/career_mode/enums.lua.
--
-- STAGE 1 (this script): for each stats manager, fetch its object via
-- the SAME GetManagerObjByTypeId the Live Editor libs use, then read ONLY
-- the first 0x300 bytes OF THAT OBJECT as qwords. It never follows a
-- pointer found inside it — so it can only touch memory the manager
-- itself owns. Each qword is classified, and consecutive (begin,end)
-- pairs that look like an eastl::vector are flagged. Stage 2 (a separate
-- script, written from this report) will inspect specific candidates.
--
-- Run via Live Editor's Lua Engine (NOT bound to F10), in a career save
-- where your team has PLAYED a few matches.
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_stats_memory_stage1.txt
-- Flushed after every manager AND every row, so a crash still shows
-- exactly which read was last.
-- ============================================================

require 'imports/other/helpers'
MEMORY = require 'imports/core/memory'
require 'imports/career_mode/enums'
require 'imports/career_mode/helpers'
require 'imports/services/enums'

local report = {}
local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_stats_memory_stage1.txt"
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end
local function log(line) table.insert(report, line) end

local OBJ_BYTES = 0x300

local function looks_like_ptr(v)
    return v and v >= 0x10000 and v < 0x7FFFFFFFFFFF and (v % 8 == 0)
end

local function classify(v)
    if v == 0 then return "0" end
    if looks_like_ptr(v) then return "PTR" end
    if v > 0 and v < 0x100000000 then
        local lo = v & 0xFFFFFFFF
        local hi = (v >> 32) & 0xFFFFFFFF
        if hi == 0 then return string.format("int=%d", lo) end
        return string.format("int2=(%d,%d)", lo, hi)
    end
    if v < 0 then return "neg/ff" end
    return "other"
end

local function scan_manager(label, type_id)
    log("")
    log("==================== " .. label .. " (type id " .. tostring(type_id) .. ") ====================")
    flush_report()

    local ok, obj = pcall(GetManagerObjByTypeId, type_id)
    if not ok or not obj or obj == 0 then
        log("GetManagerObjByTypeId: no instance (" .. tostring(obj) .. ")")
        flush_report()
        return
    end
    log(string.format("object @ 0x%X", obj))
    flush_report()

    local qwords = {}
    for off = 0, OBJ_BYTES - 8, 8 do
        local rok, v = pcall(MEMORY.ReadQword, MEMORY, obj + off)
        qwords[off] = rok and v or nil
        log(string.format("  +0x%03X  0x%016X  %s", off, v or 0, rok and classify(v) or "READ ERROR"))
        if off % 0x40 == 0 then flush_report() end
    end
    flush_report()

    log("-- vector-looking pairs (begin,end consecutive qwords, end>begin, span<=16MB):")
    local found = 0
    for off = 0, OBJ_BYTES - 16, 8 do
        local b, e = qwords[off], qwords[off + 8]
        if looks_like_ptr(b) and looks_like_ptr(e) and e > b and (e - b) <= 0x1000000 then
            found = found + 1
            local span = e - b
            local strides = {}
            for _, s in ipairs({ 0x8, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38, 0x40, 0x48, 0x50, 0x58, 0x60, 0x70, 0x80, 0x100 }) do
                if span % s == 0 then table.insert(strides, string.format("0x%X->%d items", s, span // s)) end
            end
            log(string.format("  +0x%03X/+0x%03X  span=0x%X (%d bytes)  divisible by: %s",
                off, off + 8, span, span, table.concat(strides, ", ")))
        end
    end
    if found == 0 then log("  (none)") end
    flush_report()
end

log("FC27 stats memory scan, stage 1")
local dok, d = pcall(GetCurrentDate)
if dok and d then log(string.format("GetCurrentDate(): %04d-%02d-%02d", d.year, d.month, d.day)) end
flush_report()

scan_manager("SeasonStatsManager", ENUM_FCEGameModesFCECareerModeSeasonStatsManager)
scan_manager("ProfileStatsManager", ENUM_FCEGameModesFCECareerModeProfileStatsManager)
scan_manager("HistoricalStatsManager", ENUM_FCEGameModesFCECareerModeHistoricalStatsManager)
-- FC 27 only (not in FC 26's enums): where the game's "dynamic overall"
-- — the current in-game rating that moves with form/role/etc., as opposed
-- to the stored base players.overallrating — is most likely held.
scan_manager("DynamicOverallManager", ENUM_FCEGameModesFCECareerModeDynamicOverallManager)

log("")
log("==================== DONE ====================")
log("Send this file back to Claude: " .. out_path)
flush_report()
print("FC27 stats memory stage 1 written to " .. out_path)
