-- ============================================================
-- FC 27 MINIFACE CAPTURE — does Live Editor v27.1.4 produce a usable PNG per player?
--
-- Live Editor's own scripts (lua/scripts/generate_minifaces*.lua) use the PlayerCapture* API with
-- DDS output. The app needs PNG (it shows the image in the UI), and the earlier FC 26 attempt
-- (test_player_capture.lua) found no output file at all. This probe settles, for 3 of YOUR squad
-- players, with the SAME calls LE ships:
--   * where "<default>" really writes,
--   * whether PNG (type 0) works with camera 0 (head+shoulders) and camera 1 (head),
--   * whether PlayerCaptureStart() blocks until done or returns immediately (timed via os.clock),
--   * whether the file is named by playerid.
--
-- Not bound to F10. Run via Live Editor's Lua Engine in a career save. Writes only image files into
-- Live Editor's own heads folder; no game tables are written.
--
-- After it runs, look in (and tell me what appeared, with file names and sizes):
--   C:\FC 27 Live Editor\mods\legacy\data\ui\imgAssets\heads
--   <game install>\LiveEditorMods\legacy\data\ui\imgAssets\heads   (if that folder exists)
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_miniface_capture_report.txt
-- ============================================================

require 'imports/other/helpers'

local report = {}
local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_miniface_capture_report.txt"
local function log(line)
    table.insert(report, line)
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end

if not IsInCM() then log("ABORT: not in career mode"); return end

log("LE version: " .. tostring(LE and LE.version))
for _, nm in ipairs({ "PlayerCaptureSetOutputDirectory", "PlayerCaptureSetCamera", "PlayerCaptureSetSize",
                      "PlayerCaptureSetType", "PlayerCaptureSetArgs", "PlayerCaptureAddPlayer",
                      "PlayerCaptureStart", "GetGoalkeepers", "GetUserTeamID" }) do
    log(string.format("  %-34s %s", nm, type(_G[nm])))
end

local team = GetUserTeamID()
if not team or team <= 0 then log("ABORT: no user team"); return end
local goalkeepers = GetGoalkeepers()

-- two outfield players from the user's team (LE's own script resolves squads the same way)
local picks = {}
local links = LE.db:GetTable("teamplayerlinks")
local rec, n = links:GetFirstRecord(), 0
while rec and rec > 0 and #picks < 3 and n < 60000 do
    n = n + 1
    if links:GetRecordFieldValue(rec, "teamid") == team then
        local pid = links:GetRecordFieldValue(rec, "playerid")
        if pid and pid > 0 and goalkeepers[pid] == nil then table.insert(picks, pid) end
    end
    rec = links:GetNextValidRecord()
end
log("user team " .. tostring(team) .. ", test players: " .. table.concat(picks, ", "))
if #picks < 3 then log("ABORT: need 3 outfield players"); return end

local function call(label, fn, ...)
    local ok, err = pcall(fn, ...)
    log(string.format("  %-44s %s", label, ok and "ok" or ("ERROR: " .. tostring(err))))
    return ok
end

-- Batch run (the first test showed Start() returns instantly and only the first of two back-to-back
-- single-player runs produced a file): ONE configuration, 3 players queued, ONE Start, head+shoulders PNG.
log("")
log("---- batch: camera 0, PNG 256x256, players " .. table.concat(picks, ", ") .. " ----")
call("SetOutputDirectory('<default>')", PlayerCaptureSetOutputDirectory, "<default>")
call("SetCamera(0)", PlayerCaptureSetCamera, 0)
call("SetSize(256,256)", PlayerCaptureSetSize, 256, 256)
call("SetType(0)", PlayerCaptureSetType, 0)
call("SetArgs(0,0)", PlayerCaptureSetArgs, 0, 0)
for _, pid in ipairs(picks) do call("AddPlayer " .. pid, PlayerCaptureAddPlayer, pid, team, false) end
call("Start", PlayerCaptureStart)
log("  Start() returned; files are written in the background (~2s each). Wait ~15s before checking the folder.")

log("")
log("DONE. Now check the heads folder(s) listed in this script's header and report the files found.")
print("FC27 miniface capture report written to " .. out_path)
