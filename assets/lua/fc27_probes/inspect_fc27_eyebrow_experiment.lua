-- ============================================================
-- FC 27 EYEBROW EXPERIMENT (apply) — why are generated faces' eyebrows cyan/blue?
--
-- Every face captured so far has cyan eyebrows regardless of eyebrowcode / haircolorcode, so the colour comes from
-- something else (or from a default that is never overridden). This temporarily changes ONE candidate field on each of
-- 10 of your generic-head squad players (each "change" may be a rewrite of the same value), captures all 10 in a single batch, and records every original value so
-- inspect_fc27_eyebrow_restore.lua can put them back. Look at the 10 PNGs afterwards: whichever variant has normal
-- eyebrows tells us which field drives the colour.
--
-- !!! BACK UP YOUR SAVE FIRST. This writes the players table (same columns the player editor writes).
-- !!! Run inspect_fc27_eyebrow_restore.lua afterwards (wait ~30 s for the captures to finish first). Do NOT save/exit
--     the career between the two scripts.
--
-- Not bound to F10/F11. Run via the Lua Engine in a career save.
-- Report:    %USERPROFILE%\Desktop\FC Tests\LE_FC27_eyebrow_experiment.txt   (variant -> playerid -> originals)
-- Originals: %USERPROFILE%\Desktop\FC Tests\LE_FC27_eyebrow_originals.txt     (read by the restore script)
-- Images:    <Live Editor>\mods\legacy\data\ui\imgAssets\heads\p<playerid>.PNG
-- ============================================================

require 'imports/other/helpers'

local dir = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\"
local report = {}
local function log(line)
    table.insert(report, line)
    local f = io.open(dir .. "LE_FC27_eyebrow_experiment.txt", "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end

if not IsInCM() then log("ABORT: not in career mode"); return end

local FIELDS = { "eyebrowcode", "haircolorcode", "facialhaircolorcode", "skinmakeup", "lipcolor",
                 "facepsdlayer0", "facepsdlayer1", "eyedetail" }

-- First round (all 10 captured): changing haircolorcode / eyebrowcode / eyedetail left the brows cyan, but WRITING
-- skinmakeup, lipcolor or facepsdlayer0/1 (even to the value they already had) gave normal brows. So this round writes
-- candidate fields back to their CURRENT value ("same") to find the smallest write that fixes the brows without changing
-- the look. Variant 1 is the control (no write). Each write happens right before the batch capture, like the real fix would.
local SAME = "same"
local VARIANTS = {
    { name = "control (no write)", set = {} },
    { name = "skinmakeup (same value)", set = { skinmakeup = SAME } },
    { name = "lipcolor (same value)", set = { lipcolor = SAME } },
    { name = "facepsdlayer0 (same value)", set = { facepsdlayer0 = SAME } },
    { name = "facepsdlayer1 (same value)", set = { facepsdlayer1 = SAME } },
    { name = "skinmakeup + lipcolor (same)", set = { skinmakeup = SAME, lipcolor = SAME } },
    { name = "all four (same)", set = { skinmakeup = SAME, lipcolor = SAME, facepsdlayer0 = SAME, facepsdlayer1 = SAME } },
    { name = "haircolorcode (same value)", set = { haircolorcode = SAME } },
    { name = "eyebrowcode (same value)", set = { eyebrowcode = SAME } },
    { name = "skinmakeup=5 (changed value)", set = { skinmakeup = 5 } },
}

local team = GetUserTeamID()
if not team or team <= 0 then log("ABORT: no user team"); return end
local goalkeepers = GetGoalkeepers()
local players = LE.db:GetTable("players")
local links = LE.db:GetTable("teamplayerlinks")

-- 1. squad ids (outfield)
local squad, wanted = {}, {}
do
    local rec, n = links:GetFirstRecord(), 0
    while rec and rec > 0 and n < 60000 do
        n = n + 1
        if links:GetRecordFieldValue(rec, "teamid") == team then
            local pid = links:GetRecordFieldValue(rec, "playerid")
            if pid and pid > 0 and goalkeepers[pid] == nil and not wanted[pid] then wanted[pid] = true; table.insert(squad, pid) end
        end
        rec = links:GetNextValidRecord()
    end
end

-- 2. keep the first 10 whose head is a generic one (the only kind the editor edits)
local picks, recFor = {}, {}
do
    local rec, n = players:GetFirstRecord(), 0
    while rec and rec > 0 and n < 30000 do
        n = n + 1
        local pid = players:GetRecordFieldValue(rec, "playerid")
        if pid and wanted[pid] and players:GetRecordFieldValue(rec, "hashighqualityhead") == 0 then recFor[pid] = rec end
        rec = players:GetNextValidRecord()
    end
end
for _, pid in ipairs(squad) do
    if recFor[pid] and #picks < #VARIANTS then table.insert(picks, pid) end
end
log("generic-head outfield squad players found: " .. #picks .. " (need " .. #VARIANTS .. ")")
if #picks < #VARIANTS then log("ABORT: not enough players"); return end

-- 3. record originals BEFORE touching anything. Refuse to run while a previous run's originals file is still there:
-- overwriting it would record the experiment's values as "originals" and make a restore impossible.
do
    local prev = io.open(dir .. "LE_FC27_eyebrow_originals.txt", "r")
    if prev then
        local has = prev:read("*a")
        prev:close()
        if has and #has > 0 then
            log("ABORT: LE_FC27_eyebrow_originals.txt exists, so the last run was not restored. Run inspect_fc27_eyebrow_restore.lua first.")
            return
        end
    end
end
local originals = {}
local of = io.open(dir .. "LE_FC27_eyebrow_originals.txt", "w+")
if not of then log("ABORT: cannot write the originals file"); return end
for i, pid in ipairs(picks) do
    local parts = { tostring(pid) }
    local row = {}
    for _, f in ipairs(FIELDS) do
        local v = players:GetRecordFieldValue(recFor[pid], f)
        row[f] = v
        table.insert(parts, f .. "=" .. tostring(v))
    end
    originals[pid] = row
    of:write(table.concat(parts, " ") .. "\n")
    of:flush()
end
of:close()

-- 4. apply the variants
log("")
for i, v in ipairs(VARIANTS) do
    local pid = picks[i]
    local o = originals[pid]
    local orig = {}
    for _, f in ipairs(FIELDS) do table.insert(orig, f .. "=" .. tostring(o[f])) end
    local status = "ok"
    for field, value in pairs(v.set) do
        if value == SAME then value = o[field] end
        local okW, err = pcall(players.SetRecordFieldValue, players, recFor[pid], field, value)
        if not okW then status = "FAILED " .. field .. ": " .. tostring(err)
        elseif players:GetRecordFieldValue(recFor[pid], field) ~= value then status = "read-back mismatch for " .. field end
    end
    log(string.format("variant %2d  p%d  %-38s [%s]  originals: %s", i, pid, v.name, status, table.concat(orig, " ")))
end

-- 5. capture all 10 in ONE batch (head and shoulders, PNG)
PlayerCaptureSetOutputDirectory("<default>")
PlayerCaptureSetCamera(0)
PlayerCaptureSetSize(256, 256)
PlayerCaptureSetType(0)
PlayerCaptureSetArgs(0, 0)
for _, pid in ipairs(picks) do PlayerCaptureAddPlayer(pid, team, false) end
PlayerCaptureStart()

log("")
log("Capture started. Wait ~30 s, copy/view the 10 PNGs, THEN run inspect_fc27_eyebrow_restore.lua.")
print("FC27 eyebrow experiment applied; run the restore script after the captures finish")
