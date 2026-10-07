-- ============================================================
-- FC 27 cmplayers vs players — is `cmplayers` the dynamic-overall copy?
--
-- Confirmed so far: players.overallrating is the BASE overall (Mark Breese
-- 460043: table 57 = in-game base 57; in-game DYNAMIC overall is 54).
-- The schema also has a `cmplayers` table with the same overallrating /
-- potential / modifier fields. If cmplayers.overallrating reads 54 for
-- Breese, that is where the dynamic value lives — a plain table read.
--
-- Pure DB reads of fields confirmed in the schema report; no memory
-- offsets. Also dumps EVERY career_playermatchratinghistory row for the
-- two stat-test players so the rows can be split by date/competition.
--
-- Run via Live Editor's Lua Engine (NOT bound to F10).
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_cmplayers_compare.txt
-- ============================================================

require 'imports/other/helpers'

local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_cmplayers_compare.txt"
local report = {}
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end
local function log(line) table.insert(report, line); flush_report() end

-- 460043 Breese (base 57, dynamic 54), 460044 Watkins, plus a few others
local TARGETS = { 460043, 460044, 460011, 460008, 460053, 20801 }
local wanted = {}
for _, id in ipairs(TARGETS) do wanted[id] = true end

local FIELDS = { "playerid", "overallrating", "potential", "modifier", "wage", "contractvaliduntil",
    "growthprofile", "personality", "composure", "reactions", "trait1", "trait2", "isretiring",
    "internationalrep", "preferredposition1" }

local function fetch(table_name)
    local t = LE.db:GetTable(table_name)
    if not t or not t.fields then log("TABLE MISSING: " .. table_name); return nil end
    log(string.format("%s: records=%s record_size=%s fields=%d",
        table_name, tostring(t.written_records), tostring(t.record_size), t:GetFieldsCount()))
    local out, remaining = {}, #TARGETS
    local rec, n = t:GetFirstRecord(), 0
    while rec and rec > 0 and n < 120000 and remaining > 0 do
        n = n + 1
        local pid = t:GetRecordFieldValue(rec, "playerid")
        if pid and wanted[pid] and not out[pid] then
            local row = {}
            for _, f in ipairs(FIELDS) do
                if t.fields[f] then row[f] = t:GetRecordFieldValue(rec, f) end
            end
            out[pid] = row
            remaining = remaining - 1
        end
        rec = t:GetNextValidRecord()
    end
    log(string.format("  walked %d records, found %d of %d targets", n, #TARGETS - remaining, #TARGETS))
    return out
end

log("FC27 cmplayers vs players")
local dok, d = pcall(GetCurrentDate)
if dok and d then log(string.format("GetCurrentDate(): %04d-%02d-%02d", d.year, d.month, d.day)) end

local players = fetch("players")
local cm = fetch("cmplayers")

log("")
log("==================== SIDE BY SIDE (players | cmplayers) ====================")
for _, id in ipairs(TARGETS) do
    log("")
    local ok, nm = pcall(GetPlayerName, id)
    log(string.format("player %d  %s", id, ok and tostring(nm) or "?"))
    local p, c = players and players[id], cm and cm[id]
    if not p then log("  not found in players") end
    if not c then log("  not found in cmplayers") end
    if p or c then
        for _, f in ipairs(FIELDS) do
            local pv = p and p[f]
            local cv = c and c[f]
            local flag = (pv ~= nil and cv ~= nil and pv ~= cv) and "   <== DIFFERS" or ""
            log(string.format("  %-20s players=%-12s cmplayers=%-12s%s", f, tostring(pv), tostring(cv), flag))
        end
    end
end

log("")
log("==================== career_playermatchratinghistory — ALL rows for Breese + Watkins ====================")
do
    local t = LE.db:GetTable("career_playermatchratinghistory")
    if not t or not t.fields then
        log("table missing")
    else
        local fields = { "artificialkey", "date", "minsplayed", "playerid", "position", "rating" }
        local rec, n = t:GetFirstRecord(), 0
        local rows = { [460043] = {}, [460044] = {} }
        while rec and rec > 0 and n < 60000 do
            n = n + 1
            local pid = t:GetRecordFieldValue(rec, "playerid")
            if rows[pid] then
                local r = {}
                for _, f in ipairs(fields) do r[#r + 1] = tostring(t:GetRecordFieldValue(rec, f)) end
                rows[pid][#rows[pid] + 1] = table.concat(r, " | ")
            end
            rec = t:GetNextValidRecord()
        end
        for _, pid in ipairs({ 460043, 460044 }) do
            log(string.format("player %d: %d rows   (artificialkey | date | mins | playerid | position | rating)", pid, #rows[pid]))
            for _, line in ipairs(rows[pid]) do log("  " .. line) end
        end
    end
end

log("")
log("DONE. Send this file back to Claude: " .. out_path)
print("FC27 cmplayers compare written to " .. out_path)
