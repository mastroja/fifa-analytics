-- ============================================================
-- FC 27 OVERALL-RECALC PROBE — needed before the player editor edits attributes.
--
-- READ-ONLY. Run via Live Editor's Lua Engine in a career save. NOT bound to F10.
--
-- Goal: decide whether the app can compute a "suggested overall" after an attribute edit.
--   1. Dumps the whole attributeprefpositionformula table (position, attribute, percentage)
--      — EA's attribute-weight formula per position (321 rows).
--   2. Dumps ~600 evenly-sampled players as CSV: playerid, preferredposition1, overallrating,
--      modifier, then every outfield + GK attribute field. Attribute ids in the formula are
--      mapped to field names offline by regression against these rows.
--
-- Outputs (%USERPROFILE%\Desktop\FC Tests\):
--   LE_FC27_overall_formula.txt   (position,attribute,percentage)
--   LE_FC27_overall_players.csv
-- ============================================================

require 'imports/other/helpers'

local dir = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\"

local ATTRS = {
    "crossing", "finishing", "headingaccuracy", "shortpassing", "volleys", "dribbling", "curve",
    "freekickaccuracy", "longpassing", "ballcontrol", "acceleration", "sprintspeed", "agility",
    "reactions", "balance", "shotpower", "jumping", "stamina", "strength", "longshots",
    "aggression", "interceptions", "positioning", "vision", "penalties", "composure",
    "defensiveawareness", "standingtackle", "slidingtackle",
    "gkdiving", "gkhandling", "gkkicking", "gkpositioning", "gkreflexes",
}

-- 1. formula table
local formula = LE.db:GetTable("attributeprefpositionformula")
local f1 = io.open(dir .. "LE_FC27_overall_formula.txt", "w+")
if f1 and formula then
    f1:write("position,attribute,percentage\n")
    local rec, n = formula:GetFirstRecord(), 0
    while rec and rec > 0 and n < 1000 do
        n = n + 1
        local ok1, p = pcall(formula.GetRecordFieldValue, formula, rec, "position")
        local ok2, a = pcall(formula.GetRecordFieldValue, formula, rec, "attribute")
        local ok3, pc = pcall(formula.GetRecordFieldValue, formula, rec, "percentage")
        f1:write(string.format("%s,%s,%s\n", tostring(ok1 and p), tostring(ok2 and a), tostring(ok3 and pc)))
        rec = formula:GetNextValidRecord()
    end
    f1:flush()
    f1:close()
end

-- 2. players
local players = LE.db:GetTable("players")
if not players then return end
local present = {}
for _, a in ipairs(ATTRS) do
    if players.fields[a] then table.insert(present, a) end
end

local f2 = io.open(dir .. "LE_FC27_overall_players.csv", "w+")
if not f2 then return end
f2:write("playerid,pos1,overall,modifier," .. table.concat(present, ",") .. "\n")

local function rd(rec, f)
    local ok, v = pcall(players.GetRecordFieldValue, players, rec, f)
    if ok and v ~= nil then return v end
    return ""
end

local rec, written, seen = players:GetFirstRecord(), 0, 0
while rec and rec > 0 and written < 600 and seen < 30000 do
    seen = seen + 1
    if seen % 30 == 1 then
        local row = { rd(rec, "playerid"), rd(rec, "preferredposition1"), rd(rec, "overallrating"), rd(rec, "modifier") }
        for _, a in ipairs(present) do table.insert(row, rd(rec, a)) end
        f2:write(table.concat(row, ",") .. "\n")
        written = written + 1
        if written % 50 == 0 then f2:flush() end
    end
    rec = players:GetNextValidRecord()
end
f2:flush()
f2:close()
print("overall recalc probe done: " .. written .. " players")
