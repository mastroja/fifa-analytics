-- ============================================================
-- FC 27 MEMORY OFFSET CHECK — SEPARATE from inspect_fc27_db_schema.lua
-- on purpose, and higher risk than that script.
--
-- Only run this AFTER the DB schema check has completed cleanly. This
-- one touches raw, undocumented hex memory offsets (standings/fixtures
-- via FCEDataManager+0x60/+0x88, transfer negotiations via
-- TransferManager+0x1DD0) reverse-engineered specifically for the FC 26
-- build — carried over unverified. Every read below reuses the exact
-- bounds-checked guards already in assets/export_all.lua (mBegin/mEnd
-- sanity, capped iteration counts) so a wrong offset should report as
-- a nonsense value rather than hang — but "should" is not "confirmed
-- safe", since these are native pointer-chase reads, not table lookups.
--
-- Run standalone via Live Editor's Lua Engine (NOT bound to F10), and
-- only when you're comfortable risking another crash/restart like the
-- one from the DB-field probe earlier. If it crashes, check this same
-- game build's Live Editor log (Logs\live_editor_<date>.log) for the
-- last [LUA API] line before the gap — that pinpoints exactly which
-- read did it, same as last time.
--
-- Writes to: %USERPROFILE%\Desktop\FC Tests\LE_FC27_memory_report.txt
-- ============================================================

require 'imports/other/helpers'
MEMORY = require 'imports/core/memory'
require 'imports/career_mode/enums'
require 'imports/career_mode/helpers'
require 'imports/services/enums'

local report = {}
local function log(line) table.insert(report, line) end
local function section(title)
    log("")
    log("==================== " .. title .. " ====================")
end

-- Flush to disk after each section, so a crash mid-script still leaves
-- a partial report showing exactly how far it got.
local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_memory_report.txt"
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then
        f:write(table.concat(report, "\n"))
        f:close()
    end
end

section("STANDINGS / FIXTURES (FCEDataManager)")
flush_report()

local function GetFCEDataManager()
    local IFCEInterface = GetPlugin(ENUM_djb2IFCEInterface_CLSS)
    return MEMORY:ReadMultilevelPointer(IFCEInterface, {0x18, 0x10, 0x08, 0x00})
end

local mok, FCEDataManager = pcall(GetFCEDataManager)
if not mok or not FCEDataManager or FCEDataManager == 0 then
    log("GetFCEDataManager(): FAILED — " .. tostring(FCEDataManager))
else
    log("GetFCEDataManager(): OK, ptr=" .. tostring(FCEDataManager))
    flush_report()

    local fok, FixtureDataList = pcall(function() return MEMORY:ReadPointer(FCEDataManager + 0x60) end)
    if not fok or not FixtureDataList or FixtureDataList == 0 then
        log("FixtureDataList (@+0x60): FAILED/NULL")
    else
        local itemSize = 0x18
        local mBegin = MEMORY:ReadPointer(FixtureDataList + 0x28)
        local max_items_count = (MEMORY:ReadInt(FixtureDataList + 0x1C) or 0) - 1
        log(string.format("FixtureDataList: mBegin=%s max_items_count=%s", tostring(mBegin), tostring(max_items_count)))
        flush_report()

        local sane = mBegin and mBegin ~= 0 and max_items_count and max_items_count > 0 and max_items_count < 5000
        if not sane then
            log("  -> UNSANE bounds, skipping fixture walk (offset is likely wrong for FC 27)")
        else
            local used_count = 0
            local sample_logged = false
            local cap = math.min(max_items_count, 2000)
            for i = 0, cap do
                local mCurrent = mBegin + (itemSize * i)
                local is_used_ok, is_used = pcall(MEMORY.ReadBool, MEMORY, mCurrent + 0x14)
                if is_used_ok and is_used then
                    used_count = used_count + 1
                    if not sample_logged then
                        sample_logged = true
                        local d = MEMORY:ReadInt(mCurrent + 0x00)
                        local comp = MEMORY:ReadShort(mCurrent + 0x08)
                        local hs = MEMORY:ReadShort(mCurrent + 0x0A)
                        local as = MEMORY:ReadShort(mCurrent + 0x0C)
                        local hscore = MEMORY:ReadChar(mCurrent + 0x0F)
                        local ascore = MEMORY:ReadChar(mCurrent + 0x11)
                        local complete = MEMORY:ReadBool(mCurrent + 0x13)
                        log(string.format("  sample fixture: rawDate=%s compObjId=%s homeStandingId=%s awayStandingId=%s homeScore=%s awayScore=%s completed=%s",
                            tostring(d), tostring(comp), tostring(hs), tostring(as), tostring(hscore), tostring(ascore), tostring(complete)))
                        log("  (sane if homeScore/awayScore are small ints like 0-9, not huge garbage numbers)")
                        flush_report()

                        local hs_data_ok, hs_team = pcall(function()
                            local StandingsDataList = MEMORY:ReadPointer(FCEDataManager + 0x88)
                            local sBegin = MEMORY:ReadPointer(StandingsDataList + 0x28)
                            local sCurrent = sBegin + (0x18 * hs)
                            return MEMORY:ReadInt(sCurrent + 0x04)
                        end)
                        log("  resolved home team_id via GetStandingsByIndex-equivalent: " .. tostring(hs_data_ok and hs_team or ("ERROR: " .. tostring(hs_team))))
                        if hs_data_ok and hs_team and hs_team > 0 then
                            local tnok, tname = pcall(GetTeamName, hs_team)
                            log("  GetTeamName(that team_id): " .. tostring(tnok and tname or ("ERROR: " .. tostring(tname))))
                        end
                        flush_report()
                    end
                end
            end
            log(string.format("Total 'is_used' fixtures found: %d (out of %d slots scanned)", used_count, cap + 1))
        end
    end
end
flush_report()

section("TRANSFER NEGOTIATION STORAGE (TransferManager+0x1DD0)")
flush_report()

local tmok, transfer_mgr = pcall(GetManagerObjByTypeId, ENUM_FCEGameModesFCECareerModeTransferManager)
if not tmok or not transfer_mgr or transfer_mgr == 0 then
    log("Transfer Manager object: NOT FOUND")
else
    log("Transfer Manager object: OK, ptr=" .. tostring(transfer_mgr))
    flush_report()
    local neg_storage = MEMORY:ReadPointer(transfer_mgr + 0x1DD0)
    log("neg_storage (@+0x1DD0): " .. tostring(neg_storage))
    flush_report()

    if neg_storage and neg_storage ~= 0 then
        local vec = MEMORY:ReadPointer(neg_storage + 0x10)
        local mBegin = vec and MEMORY:ReadPointer(vec + 0x0)
        local mEnd = vec and MEMORY:ReadPointer(vec + 0x8)
        log(string.format("AI player-transfer vector: mBegin=%s mEnd=%s", tostring(mBegin), tostring(mEnd)))
        flush_report()
        local sane = mBegin and mEnd and mBegin ~= 0 and mEnd ~= 0 and mEnd >= mBegin and (mEnd - mBegin) < (0xB0 * 2000)
        if not sane then
            log("  -> UNSANE bounds, this offset is likely wrong for FC 27")
        else
            local obj_size = 0xB0
            local count = math.floor((mEnd - mBegin) / obj_size)
            log(string.format("  entry count implied by bounds: %d", count))
            if count > 0 and count < 2000 then
                local current = mBegin
                local playerid = MEMORY:ReadInt(current + 0x0)
                local buying_team = MEMORY:ReadInt(current + 0x4)
                local selling_team = MEMORY:ReadInt(current + 0x8)
                log(string.format("  sample entry[0]: playerid=%s buying_team=%s selling_team=%s (sane if these are plausible ids, not 0/huge garbage)",
                    tostring(playerid), tostring(buying_team), tostring(selling_team)))
            end
        end
    end
end

section("DONE")
log("Copy everything above (and note whether it crashed) back to Claude.")
flush_report()
print("[CompanionApp] FC27 memory report written to " .. out_path)
