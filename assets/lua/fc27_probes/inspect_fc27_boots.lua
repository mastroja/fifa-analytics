-- ============================================================
-- FC 27 BOOTS PROBE — step 1 of the boot picker in the player editor.
--
-- READ-ONLY. Run via Live Editor's Lua Engine in a career save. NOT bound to a hotkey.
--
-- Answers: which boot ids exist, what they are, which ones the game really uses on players,
-- and which colour codes exist. The shoe IDs are what the picker will map images to.
--
--   1. playerboots   : every boot row (shoetype id, manufacturer, design, colours, flags)
--   2. footwear      : the shoeid list (clothing/boot model ids)
--   3. shoecolors    : colour id -> RGB (for swatches)
--   4. players       : tally of shoetypecode / shoecolorcode1 / shoecolorcode2 /
--                      smallsidedshoetypecode, across all players and across the user's
--                      squad + academy, with a few example players per boot id
--
-- Only table field reads (pcall'd, capped). Reports:
--   %USERPROFILE%\Desktop\FC Tests\LE_FC27_boots_report.txt
--   %USERPROFILE%\Desktop\FC Tests\LE_FC27_boots_playerboots.csv
-- ============================================================

require 'imports/other/helpers'

local dir = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\"
local report = {}
local out_path = dir .. "LE_FC27_boots_report.txt"
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end
local function log(l) table.insert(report, l) end
local function section(t) log(""); log("==================== " .. t .. " ===================="); flush_report() end

local function open_table(name)
    local ok, t = pcall(function() return LE.db:GetTable(name) end)
    if not ok or not t or not t.fields then log("TABLE MISSING: " .. name); return nil end
    return t
end
local function rd(t, rec, f)
    local ok, v = pcall(t.GetRecordFieldValue, t, rec, f)
    if ok then return v end
    return nil
end
local function sorted_field_names(t)
    local keys = {}
    for k in pairs(t.fields) do table.insert(keys, k) end
    table.sort(keys)
    return keys
end

-- 1. playerboots -> CSV + summary
section("1. playerboots")
local pb = open_table("playerboots")
if pb then
    local fields = sorted_field_names(pb)
    log("fields: " .. table.concat(fields, ", "))
    local csv = io.open(dir .. "LE_FC27_boots_playerboots.csv", "w+")
    if csv then csv:write(table.concat(fields, ",") .. "\n") end
    local rec, n = pb:GetFirstRecord(), 0
    local manufacturers, minType, maxType = {}, nil, nil
    while rec and rec > 0 and n < 2000 do
        n = n + 1
        local row = {}
        for _, f in ipairs(fields) do row[#row + 1] = tostring(rd(pb, rec, f)) end
        if csv then csv:write(table.concat(row, ",") .. "\n") end
        local st = rd(pb, rec, "shoetype")
        local m = rd(pb, rec, "manufacturerid")
        if st then
            if not minType or st < minType then minType = st end
            if not maxType or st > maxType then maxType = st end
        end
        manufacturers[m or -1] = (manufacturers[m or -1] or 0) + 1
        rec = pb:GetNextValidRecord()
    end
    if csv then csv:flush(); csv:close() end
    log(string.format("rows=%d shoetype range=[%s..%s]", n, tostring(minType), tostring(maxType)))
    local ms = {}
    for m, c in pairs(manufacturers) do table.insert(ms, tostring(m) .. "x" .. c) end
    table.sort(ms)
    log("manufacturerid counts: " .. table.concat(ms, " "))
    log("(full rows in LE_FC27_boots_playerboots.csv)")
end
flush_report()

-- 2. footwear
section("2. footwear (shoeid list)")
local fw = open_table("footwear")
if fw then
    local rec, n, ids = fw:GetFirstRecord(), 0, {}
    local byType = {}
    while rec and rec > 0 and n < 3000 do
        n = n + 1
        local id = rd(fw, rec, "shoeid")
        local ct = rd(fw, rec, "clothingtype")
        if id then table.insert(ids, id) end
        byType[ct or -1] = (byType[ct or -1] or 0) + 1
        rec = fw:GetNextValidRecord()
    end
    table.sort(ids)
    log(string.format("rows=%d  min=%s max=%s", n, tostring(ids[1]), tostring(ids[#ids])))
    local ts = {}
    for t, c in pairs(byType) do table.insert(ts, "clothingtype " .. tostring(t) .. "x" .. c) end
    table.sort(ts)
    log(table.concat(ts, "; "))
    local head = {}
    for i = 1, math.min(#ids, 80) do head[#head + 1] = ids[i] end
    log("first 80 ids: " .. table.concat(head, ","))
end
flush_report()

-- 3. shoecolors
section("3. shoecolors (id -> RGB)")
local sc = open_table("shoecolors")
if sc then
    local rec, n = sc:GetFirstRecord(), 0
    while rec and rec > 0 and n < 200 do
        n = n + 1
        log(string.format("  colorid=%s r=%s g=%s b=%s", tostring(rd(sc, rec, "colorid")), tostring(rd(sc, rec, "red")),
            tostring(rd(sc, rec, "green")), tostring(rd(sc, rec, "blue"))))
        rec = sc:GetNextValidRecord()
    end
end
flush_report()

-- 4. players: what is actually in use
section("4. players: boot values in use")
local players = open_table("players")
if players then
    local FIELDS = { "shoetypecode", "shoecolorcode1", "shoecolorcode2", "smallsidedshoetypecode" }
    local present = {}
    for _, f in ipairs(FIELDS) do
        if players.fields[f] then table.insert(present, f) else log("players field MISSING: " .. f) end
    end

    -- the user's squad + academy ids (same selection as player_editor_sync.lua)
    local mine = {}
    local okU, user_team_id = pcall(GetUserTeamID)
    local tpl = open_table("teamplayerlinks")
    if tpl and okU and user_team_id and user_team_id > 0 then
        local rec, n = tpl:GetFirstRecord(), 0
        while rec and rec > 0 and n < 60000 do
            n = n + 1
            if rd(tpl, rec, "teamid") == user_team_id then mine[rd(tpl, rec, "playerid") or -1] = true end
            rec = tpl:GetNextValidRecord()
        end
    end
    local youth = open_table("career_youthplayers")
    if youth then
        local rec, n = youth:GetFirstRecord(), 0
        while rec and rec > 0 and n < 500 do
            n = n + 1
            mine[rd(youth, rec, "playerid") or -1] = true
            rec = youth:GetNextValidRecord()
        end
    end

    local all, own = {}, {}
    local examples = {}  -- shoetypecode -> up to 3 example "playerid name"
    for _, f in ipairs(present) do all[f] = {}; own[f] = {} end
    local rec, scanned = players:GetFirstRecord(), 0
    while rec and rec > 0 and scanned < 30000 do
        scanned = scanned + 1
        local pid = rd(players, rec, "playerid")
        for _, f in ipairs(present) do
            local v = rd(players, rec, f)
            all[f][v] = (all[f][v] or 0) + 1
            if pid and mine[pid] then own[f][v] = (own[f][v] or 0) + 1 end
        end
        local st = rd(players, rec, "shoetypecode")
        if st and (not examples[st] or #examples[st] < 3) then
            local okn, name = pcall(GetPlayerName, pid)
            examples[st] = examples[st] or {}
            table.insert(examples[st], tostring(pid) .. " " .. (okn and name or "?"))
        end
        rec = players:GetNextValidRecord()
    end
    log("players scanned: " .. scanned)

    local function dump(label, counts)
        local keys = {}
        for k in pairs(counts) do table.insert(keys, k) end
        table.sort(keys, function(a, b) return (tonumber(a) or -1) < (tonumber(b) or -1) end)
        local parts = {}
        for _, k in ipairs(keys) do parts[#parts + 1] = tostring(k) .. "x" .. counts[k] end
        log(string.format("%s: %d distinct", label, #keys))
        log("  " .. table.concat(parts, " "))
    end
    for _, f in ipairs(present) do
        dump("ALL players  " .. f, all[f])
        dump("YOUR players " .. f, own[f])
    end

    log("")
    log("example players per shoetypecode (up to 3):")
    local ek = {}
    for k in pairs(examples) do table.insert(ek, k) end
    table.sort(ek, function(a, b) return (tonumber(a) or -1) < (tonumber(b) or -1) end)
    for _, k in ipairs(ek) do log("  " .. tostring(k) .. ": " .. table.concat(examples[k], " | ")) end
end

section("DONE")
