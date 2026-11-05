-- ============================================================
-- FC 27 FORMATIONS — cross-check for the depth chart's formation list (js/depth_chart.js).
--
-- Lists every distinct formation in the game's `formations` table (one row per team formation, 899 rows in the
-- v27.1.2 schema dump): its name, how many teams use it, and the position in each of the 11 slots, so the app's
-- 30 official shapes can be compared with the game's own.
--
-- Table reads only. No raw memory, no writes. Run via Live Editor's Lua Engine (NOT bound to F10).
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_formations_report.txt
-- ============================================================

require 'imports/other/helpers'

local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_formations_report.txt"
local report = {}
local function log(line) table.insert(report, line) end
local function flush()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end

-- same labels as POSITION_MAP in js/app.js
local POS = { [0] = "GK", "SW", "RWB", "RB", "RCB", "CB", "LCB", "LB", "LWB", "RDM", "CDM", "LDM", "RM", "RCM", "CM",
    "LCM", "LM", "RAM", "CAM", "LAM", "RF", "CF", "LF", "RW", "RS", "ST", "LS", "LW" }

local t = LE.db:GetTable("formations")
if not t then
    log("formations table not readable"); flush(); return
end
local function v(rec, f)
    local ok, x = pcall(t.GetRecordFieldValue, t, rec, f)
    return ok and x or nil
end

local byName, order = {}, {}
local rec, n = t:GetFirstRecord(), 0
while rec and rec > 0 and n < 5000 do
    n = n + 1
    local name = tostring(v(rec, "formationname") or "?")
    local slots = {}
    for i = 0, 10 do
        local p = v(rec, "position" .. i)
        slots[#slots + 1] = POS[p] or tostring(p)
    end
    local shape = table.concat(slots, " ")
    local key = name .. " | " .. shape
    if not byName[key] then
        byName[key] = { name = name, shape = shape, teams = 0, fullnameid = v(rec, "formationfullnameid"), id = v(rec, "formationid") }
        order[#order + 1] = key
    end
    byName[key].teams = byName[key].teams + 1
    rec = t:GetNextValidRecord()
end

table.sort(order, function(a, b) return a < b end)
log(string.format("rows read: %d   distinct name+shape: %d", n, #order))
log("name                 teams  formationid fullnameid  slots 0-10")
for _, key in ipairs(order) do
    local e = byName[key]
    log(string.format("%-20s %5d  %11s %10s  %s", e.name, e.teams, tostring(e.id), tostring(e.fullnameid), e.shape))
end
log("")
log("Send the whole file back to Claude: " .. out_path)
flush()
print("FC27 formations report written to " .. out_path)
