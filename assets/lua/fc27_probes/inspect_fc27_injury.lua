-- ============================================================
-- FC 27 INJURY CHECK — low risk, read-only, run standalone (NOT F10).
--
-- Dumps the raw teamplayerlinks.injury value for Malik Kane (playerid 460012)
-- and for every row on the user's team, plus any row league-wide with a
-- non-zero value, so we can see which value the game uses for an injured player
-- (and whether Kane's row is the one the export picks).
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_injury_report.txt
-- ============================================================

require 'imports/other/helpers'

local report = {}
local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_injury_report.txt"
local function log(line) table.insert(report, line) end
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end

local TARGET_ID = 460012 -- Malik Kane
local user_team_id = GetUserTeamID()
log("user_team_id = " .. tostring(user_team_id))
log("playerid | teamid | injury | note")

local tpl = LE.db:GetTable("teamplayerlinks")
local rec = tpl:GetFirstRecord()
local nonzero_other, shown = 0, 0
while rec > 0 do
    local pid = tpl:GetRecordFieldValue(rec, "playerid")
    local tid = tpl:GetRecordFieldValue(rec, "teamid")
    local inj = tpl:GetRecordFieldValue(rec, "injury")
    local note = nil
    if pid == TARGET_ID then note = "<== Malik Kane"
    elseif tid == user_team_id then note = "user team"
    elseif inj and inj ~= 0 then nonzero_other = nonzero_other + 1; note = "other team, injured" end
    if note and (pid == TARGET_ID or tid == user_team_id or (inj and inj ~= 0 and nonzero_other <= 40)) then
        log(string.format("%s | %s | %s | %s", tostring(pid), tostring(tid), tostring(inj), note))
        shown = shown + 1
    end
    rec = tpl:GetNextValidRecord()
end
log("non-zero rows on other teams: " .. nonzero_other)
flush_report()
