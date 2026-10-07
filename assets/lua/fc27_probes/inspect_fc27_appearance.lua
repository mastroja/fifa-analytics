-- ============================================================
-- FC 27 APPEARANCE PROBE — step 1 of the player editor.
--
-- READ-ONLY. Run via Live Editor's Lua Engine in a career save. NOT bound to F10.
--
-- Answers the open question: do academy regens use Cranium (morph tables keyed by
-- players.headassetid) or the legacy generic head types (players.headtypecode)?
--
--   1. Dumps every appearance column for each career_youthplayers player.
--   2. For each academy player's headassetid, checks which morph/skin tables contain
--      that assetid (cranium families: highres_/dc_/cp_/slc_/spa_ + career_youth_skins etc.).
--   3. Tallies distinct values per appearance column (academy vs all players) so the
--      editor can validate against real ranges.
--   4. Lists small lookup tables (accessories, tattoo, outfithairlinks) for pickers.
--
-- Only table field reads (all fields confirmed by the FC27 schema report), pcall around
-- every read, hard caps on every loop. Only the assetid column of the morph tables is read.
--
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_appearance_report.txt (flushed per section)
-- ============================================================

require 'imports/other/helpers'

local report = {}
local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_appearance_report.txt"
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end
local function log(line) table.insert(report, line) end
local function section(title)
    log(""); log("==================== " .. title .. " ===================="); flush_report()
end

local APPEARANCE = {
    "skintonecode", "skintypecode", "skincomplexion", "skinmakeup", "skinsurfacepack",
    "headtypecode", "headassetid", "headclasscode", "headvariation", "hashighqualityhead",
    "hairtypecode", "haircolorcode", "hairstylecode", "facialhairtypecode", "facialhaircolorcode",
    "sideburnscode", "eyebrowcode", "eyecolorcode", "eyedetail",
    "accessorycode1", "accessorycode2", "accessorycode3", "accessorycode4",
    "accessorycolourcode1", "accessorycolourcode2", "accessorycolourcode3", "accessorycolourcode4",
    "bodytypecode", "height", "weight",
    "tattoohead", "tattooback", "tattoofront", "tattooleftarm", "tattoorightarm",
    "tattooleftleg", "tattoorightleg", "usercaneditname",
}

local ALL_CAP = 30000
local MORPH_CAP = 40000

local function rd(tbl, rec, field)
    local ok, v = pcall(tbl.GetRecordFieldValue, tbl, rec, field)
    if ok then return v end
    return nil
end

local function walk(tbl, cap, cb)
    local rec = tbl:GetFirstRecord()
    local i = 0
    while rec and rec > 0 and i < cap do
        i = i + 1
        if cb(rec, i) then return i end
        rec = tbl:GetNextValidRecord()
    end
    return i
end

local function open_table(name)
    local ok, t = pcall(function() return LE.db:GetTable(name) end)
    if not ok or not t or not t.fields then log("TABLE MISSING: " .. name); return nil end
    return t
end

local function has_field(t, f) return t.fields[f] ~= nil end

-- ---------- 1. academy players ----------
section("1. ACADEMY PLAYERS (career_youthplayers) -> players appearance columns")
local players = open_table("players")
local youth = open_table("career_youthplayers")
if not players or not youth then log("ABORT: players/career_youthplayers missing"); flush_report(); return end

local present = {}
for _, f in ipairs(APPEARANCE) do
    if has_field(players, f) then table.insert(present, f) else log("players field MISSING: " .. f) end
end

local youth_ids, youth_set = {}, {}
walk(youth, 500, function(rec)
    local pid = rd(youth, rec, "playerid")
    if pid and pid > 0 and not youth_set[pid] then youth_set[pid] = true; table.insert(youth_ids, pid) end
end)
log("academy players found: " .. #youth_ids)

local youth_rows = {}  -- pid -> {field=value}
local youth_assets = {}
-- one pass over players, pulling only the academy rows
walk(players, ALL_CAP, function(rec)
    local pid = rd(players, rec, "playerid")
    if pid and youth_set[pid] then
        local row = { _rec = rec }
        for _, f in ipairs(present) do row[f] = rd(players, rec, f) end
        youth_rows[pid] = row
        table.insert(youth_assets, row.headassetid)
        log(string.format("-- playerid %d (%s)", pid, tostring(pcall(GetPlayerName, pid) and GetPlayerName(pid) or "?")))
        for _, f in ipairs(present) do log(string.format("   %-24s = %s", f, tostring(row[f]))) end
        flush_report()
    end
end)

-- ---------- 2. which tables contain the academy headassetids ----------
section("2. WHERE DO ACADEMY headassetid VALUES LIVE? (assetid lookup)")
local asset_tables = {
    "career_youth_skins", "highres_fat", "highres_flesh", "highres_skeletal", "highres_skins",
    "dc_fat", "dc_flesh", "dc_skeletal", "dc_skins",
    "cp_fat", "cp_flesh", "cp_skeletal",
    "slc_fat", "slc_flesh", "slc_skeletal", "slc_skins",
    "spa_fat", "spa_flesh", "spa_skeletal", "spa_skins",
    "skins", "preset_skins",
}
local wanted = {}
for _, a in ipairs(youth_assets) do if a then wanted[a] = true end end

for _, name in ipairs(asset_tables) do
    local t = open_table(name)
    if t then
        if has_field(t, "assetid") then
            local found, scanned, min_id, max_id = {}, 0, nil, nil
            scanned = walk(t, MORPH_CAP, function(rec)
                local a = rd(t, rec, "assetid")
                if a then
                    if not min_id or a < min_id then min_id = a end
                    if not max_id or a > max_id then max_id = a end
                    if wanted[a] then table.insert(found, a) end
                end
            end)
            log(string.format("%-20s scanned=%d assetid range=[%s..%s] matches=%d%s", name, scanned,
                tostring(min_id), tostring(max_id), #found,
                #found > 0 and (" ids=" .. table.concat(found, ",")) or ""))
        else
            log(string.format("%-20s has NO assetid field", name))
        end
        flush_report()
    end
end

-- headtypecode keyed tables (legacy generic path): do academy headtypecodes match basehead rows?
section("2b. LEGACY PATH: basehead_* rows keyed by headtypecode?")
for _, name in ipairs({ "basehead_fat", "basehead_flesh", "basehead_skeletal" }) do
    local t = open_table(name)
    if t then
        log(name .. " has headtypecode=" .. tostring(has_field(t, "headtypecode")) ..
            " assetid=" .. tostring(has_field(t, "assetid")))
        if has_field(t, "headtypecode") then
            local seen = {}
            walk(t, 2000, function(rec)
                local v = rd(t, rec, "headtypecode"); if v then seen[v] = (seen[v] or 0) + 1 end
            end)
            local keys = {}
            for k in pairs(seen) do table.insert(keys, k) end
            table.sort(keys)
            log("  distinct headtypecode values in table: " .. #keys .. " [" .. table.concat(keys, ",", 1, math.min(#keys, 80)) .. (#keys > 80 and ",..." or "") .. "]")
            for pid, row in pairs(youth_rows) do
                log(string.format("  academy %d headtypecode=%s present in basehead=%s", pid, tostring(row.headtypecode), tostring(seen[row.headtypecode] ~= nil)))
            end
        end
        flush_report()
    end
end

-- ---------- 3. tallies ----------
local function tally(label, rows_iter)
    local counts = {}
    rows_iter(function(row)
        for _, f in ipairs(present) do
            counts[f] = counts[f] or {}
            local v = row[f]
            counts[f][v] = (counts[f][v] or 0) + 1
        end
    end)
    section("3. DISTINCT-VALUE TALLY: " .. label)
    for _, f in ipairs(present) do
        local vals = {}
        for v in pairs(counts[f] or {}) do table.insert(vals, v) end
        table.sort(vals, function(a, b) return (tonumber(a) or 0) < (tonumber(b) or 0) end)
        local n = #vals
        local mn, mx = vals[1], vals[n]
        local parts = {}
        if n <= 40 then
            for _, v in ipairs(vals) do table.insert(parts, tostring(v) .. "x" .. counts[f][v]) end
        end
        log(string.format("%-24s distinct=%-5d min=%s max=%s %s", f, n, tostring(mn), tostring(mx),
            n <= 40 and ("{" .. table.concat(parts, " ") .. "}") or "(too many to list)"))
    end
    flush_report()
end

tally("academy players", function(cb) for _, row in pairs(youth_rows) do cb(row) end end)

-- all players: generic vs real split by headclasscode / hashighqualityhead
local all_rows, scanned_all = {}, 0
scanned_all = walk(players, ALL_CAP, function(rec)
    local row = {}
    for _, f in ipairs(present) do row[f] = rd(players, rec, f) end
    table.insert(all_rows, row)
end)
log(""); log("all players scanned: " .. scanned_all)
tally("ALL players", function(cb) for _, r in ipairs(all_rows) do cb(r) end end)

local generic = {}
for _, r in ipairs(all_rows) do if r.hashighqualityhead == 0 then table.insert(generic, r) end end
tally("players with hashighqualityhead=0 (non-scanned)", function(cb) for _, r in ipairs(generic) do cb(r) end end)

-- ---------- 4. lookup tables for pickers ----------
section("4. LOOKUP TABLES")
local function dump_small(name, cap)
    local t = open_table(name)
    if not t then return end
    local keys = {}
    for k in pairs(t.fields) do table.insert(keys, k) end
    table.sort(keys)
    log(name .. " fields: " .. table.concat(keys, ", "))
    walk(t, cap, function(rec, i)
        local parts = {}
        for _, f in ipairs(keys) do table.insert(parts, f .. "=" .. tostring(rd(t, rec, f))) end
        log("  " .. table.concat(parts, " "))
    end)
    flush_report()
end
dump_small("accessories", 200)
dump_small("outfithairlinks", 150)
dump_small("tattoo", 40)

section("DONE")
