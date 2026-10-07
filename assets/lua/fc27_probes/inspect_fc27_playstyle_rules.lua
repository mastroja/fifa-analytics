-- ============================================================
-- FC 27 PLAYSTYLE RULES PROBE — needed before the player editor writes playstyles.
--
-- READ-ONLY. Run via Live Editor's Lua Engine in a career save. NOT bound to F10.
--
-- Questions answered (all from players.trait1/trait2/icontrait1/icontrait2):
--   1. Is every PlayStyle+ bit (icontrait) also set in the base bitmask (trait)?
--   2. How many base playstyles / PlayStyle+ does one player have (distribution + max)?
--   3. Which bits are ever set in each field (valid bit masks)?
--   4. Any bits set that are NOT in the known enum (playstyles_enum.lua)?
--   5. Do goalkeepers (preferredposition1 == 0) carry playstyles?
--
-- Hard cap on records, pcall around every read. Report:
--   %USERPROFILE%\Desktop\FC Tests\LE_FC27_playstyle_rules_report.txt
-- ============================================================

require 'imports/other/helpers'

local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_playstyle_rules_report.txt"
local report = {}
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end
local function log(l) table.insert(report, l) end
local function section(t) log(""); log("==================== " .. t .. " ===================="); flush_report() end

local CAP = 30000
local players = LE.db:GetTable("players")
if not players then log("ABORT: players table missing"); flush_report(); return end
for _, f in ipairs({ "trait1", "trait2", "icontrait1", "icontrait2", "preferredposition1" }) do
    if not players.fields[f] then log("MISSING FIELD: " .. f); flush_report(); return end
end

local function rd(rec, f)
    local ok, v = pcall(players.GetRecordFieldValue, players, rec, f)
    if ok and v then return v end
    return 0
end

local function popcount(v)
    local n = 0
    while v > 0 do n = n + (v % 2); v = math.floor(v / 2) end
    return n
end

-- bitwise OR of two non-negative integers without a bit library
local function bor(a, b)
    local result, bit = 0, 1
    while a > 0 or b > 0 do
        if (a % 2 == 1) or (b % 2 == 1) then result = result + bit end
        a = math.floor(a / 2); b = math.floor(b / 2); bit = bit * 2
    end
    return result
end

-- true if `sub` has a bit set that `base` does not
local function not_subset(sub, base)
    while sub > 0 do
        if (sub % 2 == 1) and (base % 2 == 0) then return true end
        sub = math.floor(sub / 2); base = math.floor(base / 2)
    end
    return false
end

local KNOWN1 = 2 ^ 30 - 1
local ORED = { trait1 = 0, trait2 = 0, icontrait1 = 0, icontrait2 = 0 }
local violations = { [1] = 0, [2] = 0 }
local viol_examples = {}
local base_count, plus_count = {}, {}
local max_base, max_plus = 0, 0
local gk = { n = 0, with_trait = 0 }
local outfield = { n = 0 }
local scanned = 0

local rec = players:GetFirstRecord()
while rec and rec > 0 and scanned < CAP do
    scanned = scanned + 1
    local t1, t2 = rd(rec, "trait1"), rd(rec, "trait2")
    local i1, i2 = rd(rec, "icontrait1"), rd(rec, "icontrait2")
    local pos = rd(rec, "preferredposition1")

    ORED.trait1 = bor(ORED.trait1, t1)
    ORED.trait2 = bor(ORED.trait2, t2)
    ORED.icontrait1 = bor(ORED.icontrait1, i1)
    ORED.icontrait2 = bor(ORED.icontrait2, i2)

    for idx, pair in ipairs({ { t1, i1 }, { t2, i2 } }) do
        if not_subset(pair[2], pair[1]) then
            violations[idx] = violations[idx] + 1
            if #viol_examples < 10 then
                table.insert(viol_examples, string.format("rec %d trait%d=%d icontrait%d=%d", rec, idx, pair[1], idx, pair[2]))
            end
        end
    end

    local nb = popcount(t1) + popcount(t2)
    local np = popcount(i1) + popcount(i2)
    base_count[nb] = (base_count[nb] or 0) + 1
    plus_count[np] = (plus_count[np] or 0) + 1
    if nb > max_base then max_base = nb end
    if np > max_plus then max_plus = np end

    if pos == 0 then
        gk.n = gk.n + 1
        if nb > 0 then gk.with_trait = gk.with_trait + 1 end
    else
        outfield.n = outfield.n + 1
    end
    rec = players:GetNextValidRecord()
end

section("RESULTS (" .. scanned .. " players scanned)")
log("PlayStyle+ (icontrait) bits NOT contained in base trait bits:")
log("  pair 1 (trait1/icontrait1): " .. violations[1] .. " players")
log("  pair 2 (trait2/icontrait2): " .. violations[2] .. " players")
for _, e in ipairs(viol_examples) do log("  example: " .. e) end

local function dist(t)
    local keys = {}
    for k in pairs(t) do table.insert(keys, k) end
    table.sort(keys)
    local parts = {}
    for _, k in ipairs(keys) do table.insert(parts, k .. ":" .. t[k]) end
    return table.concat(parts, "  ")
end
log("")
log("Base playstyles per player  (count:players): " .. dist(base_count) .. "   MAX=" .. max_base)
log("PlayStyle+ per player       (count:players): " .. dist(plus_count) .. "   MAX=" .. max_plus)
log("")
log(string.format("OR of all values: trait1=%d icontrait1=%d trait2=%d icontrait2=%d",
    ORED.trait1, ORED.icontrait1, ORED.trait2, ORED.icontrait2))
log(string.format("  trait1 has bits outside the known 30-bit mask: %s", tostring(ORED.trait1 > KNOWN1)))
log(string.format("  icontrait1 has bits outside the known 30-bit mask: %s", tostring(ORED.icontrait1 > KNOWN1)))
log("")
log(string.format("Goalkeepers (preferredposition1==0): %d, with any base playstyle: %d; outfield: %d",
    gk.n, gk.with_trait, outfield.n))
flush_report()
section("DONE")
