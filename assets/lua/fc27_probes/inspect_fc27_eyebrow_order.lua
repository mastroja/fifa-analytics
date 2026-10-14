-- ============================================================
-- FC 27 EYEBROW ORDER TEST — is the cyan brow a player-data problem or a capture-timing one?
--
-- The two write experiments gave normal brows only for players captured at batch positions 7-9, whatever was written.
-- This script writes NOTHING. It captures the same 10 generic-head squad players as the experiment, in REVERSE order,
-- so every player moves to a different batch position.
--   * normal brows follow the POSITION (new positions 7-9 = 460051's old neighbours swap) -> timing / warm-up
--   * normal brows stay with 460051 and 460044 -> something in those players' data
-- Run it TWICE in a row (wait ~30 s between runs) to see whether a second pass is any different from the first.
--
-- Not bound to F10/F11. Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_eyebrow_order.txt
-- Images: <Live Editor>\mods\legacy\data\ui\imgAssets\heads\p<playerid>.PNG (overwritten each run)
-- ============================================================

require 'imports/other/helpers'

local report = {}
local function log(line)
    table.insert(report, line)
    local f = io.open(os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_eyebrow_order.txt", "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end

if not IsInCM() then log("ABORT: not in career mode"); return end

-- same players as the experiment, forward order = the experiment's order
local FORWARD = { 460038, 460083, 460028, 460006, 460070, 460072, 460051, 460044, 460041, 460021 }

local team = GetUserTeamID()
if not team or team <= 0 then log("ABORT: no user team"); return end

PlayerCaptureSetOutputDirectory("<default>")
PlayerCaptureSetCamera(0)
PlayerCaptureSetSize(256, 256)
PlayerCaptureSetType(0)
PlayerCaptureSetArgs(0, 0)
for i = #FORWARD, 1, -1 do
    local pid = FORWARD[i]
    PlayerCaptureAddPlayer(pid, team, false)
    log(string.format("batch position %2d: p%d (experiment position was %d)", #FORWARD - i + 1, pid, i))
end
PlayerCaptureStart()
log("Capture started in REVERSE order. Wait ~30 s, then send the heads folder.")
print("FC27 eyebrow order test started")
