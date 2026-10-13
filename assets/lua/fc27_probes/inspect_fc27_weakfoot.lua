-- ============================================================
-- FC 27 WEAK FOOT CHECK — low risk, read-only, run standalone (NOT F10).
--
-- The app shows Joseph Hunter (playerid 460010) at 1 star weak foot but the
-- game shows 2. This dumps the raw `weakfootabilitytypecode` and `skillmoves`
-- for him plus every player on the user's team, using only the
-- players table / field names export_all.lua already reads.
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_weakfoot_report.txt
-- ============================================================

require 'imports/other/helpers'

local report = {}
local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_weakfoot_report.txt"
local function log(line) table.insert(report, line) end
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end

local TARGET_ID = 460010 -- Joseph Hunter

local user_team_id = GetUserTeamID()
log("user_team_id = " .. tostring(user_team_id))
log("playerid | team | ovr | weakfootabilitytypecode | skillmoves")

local players_table = LE.db:GetTable("players")
local rec = players_table:GetFirstRecord()
local n = 0
while rec > 0 do
    local pid = players_table:GetRecordFieldValue(rec, "playerid")
    if pid and pid > 0 then
        local team_id = GetTeamIdFromPlayerId(pid)
        if pid == TARGET_ID or team_id == user_team_id then
            log(string.format("%s | %s | %s | %s | %s%s",
                tostring(pid), tostring(team_id),
                tostring(players_table:GetRecordFieldValue(rec, "overallrating")),
                tostring(players_table:GetRecordFieldValue(rec, "weakfootabilitytypecode")),
                tostring(players_table:GetRecordFieldValue(rec, "skillmoves")),
                pid == TARGET_ID and "   <== Joseph Hunter" or ""))
            n = n + 1
        end
    end
    rec = players_table:GetNextValidRecord()
end
log("rows: " .. n)
flush_report()
