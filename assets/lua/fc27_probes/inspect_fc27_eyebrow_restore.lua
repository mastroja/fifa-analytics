-- ============================================================
-- FC 27 EYEBROW EXPERIMENT (restore) — undoes inspect_fc27_eyebrow_experiment.lua.
--
-- Reads %USERPROFILE%\Desktop\FC Tests\LE_FC27_eyebrow_originals.txt (one line per player: "<playerid> field=value ...")
-- and writes every original value back, with a read-back check. Run it once the experiment's 10 captures have finished
-- (~30 s). Safe to run twice. Report: LE_FC27_eyebrow_restore.txt in the same folder.
-- ============================================================

require 'imports/other/helpers'

local dir = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\"
local report = {}
local function log(line)
    table.insert(report, line)
    local f = io.open(dir .. "LE_FC27_eyebrow_restore.txt", "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end

if not IsInCM() then log("ABORT: not in career mode"); return end

local inf = io.open(dir .. "LE_FC27_eyebrow_originals.txt", "r")
if not inf then log("ABORT: originals file not found - nothing to restore"); return end

local originals, wanted = {}, {}
for line in inf:lines() do
    local pid = tonumber(line:match("^(%d+)"))
    if pid then
        local row = {}
        for field, value in line:gmatch("(%w+)=(%-?%d+)") do row[field] = tonumber(value) end
        originals[pid] = row
        wanted[pid] = true
    end
end
inf:close()

local players = LE.db:GetTable("players")
local rec, n, restored, failed = players:GetFirstRecord(), 0, 0, 0
while rec and rec > 0 and n < 30000 do
    n = n + 1
    local pid = players:GetRecordFieldValue(rec, "playerid")
    if pid and wanted[pid] then
        local bad = nil
        for field, value in pairs(originals[pid]) do
            local okW, err = pcall(players.SetRecordFieldValue, players, rec, field, value)
            if not okW then bad = field .. ": " .. tostring(err)
            elseif players:GetRecordFieldValue(rec, field) ~= value then bad = "read-back mismatch for " .. field end
        end
        if bad then failed = failed + 1; log("player " .. pid .. " FAILED " .. bad)
        else restored = restored + 1; log("player " .. pid .. " restored") end
        wanted[pid] = nil
    end
    rec = players:GetNextValidRecord()
end
for pid in pairs(wanted) do failed = failed + 1; log("player " .. pid .. " not found") end
log(string.format("DONE: %d restored, %d failed", restored, failed))
-- all players are back to their originals: clear the file so the experiment can be run again
if failed == 0 then
    pcall(os.remove, dir .. "LE_FC27_eyebrow_originals.txt")
    log("originals file removed; the experiment can be run again")
else
    log("originals file kept because something failed")
end
print("FC27 eyebrow experiment restored: " .. restored .. " ok, " .. failed .. " failed")
