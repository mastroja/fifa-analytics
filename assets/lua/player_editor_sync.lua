-- ============================================================
-- PLAYER EDITOR SYNC (both directions)   *** FC 27 ***
--
-- Bind THIS script to its own Live Editor hotkey (default F11). The companion app presses that key
-- when you open "Edit player" (to refresh the values) and when you press Save (to write them):
--   0. ACTIONS - (Transfer Hub "Release" button) ends loans and releases your loaned-out players
--   1. APPLY  - writes any edits the app queued in C:\Users\Public\ea_fc_player_edits_pending.json
--               to the players table (silent no-op when nothing is queued)
--   2. EXPORT - writes the editable state of your squad + academy to
--               C:\Users\Public\ea_fc_player_editor_export.json so the app sees the result
--
-- Safety (unchanged from the standalone scripts, which this replaces):
--   * only the players table is written; generic/regen/academy heads only (hashighqualityhead == 0)
--   * whitelist + range check on every column, drift check against the app's "old" value,
--     playstyle/position rule checks, read-back verification, `modifier` never touched
--   * hard cap of 25 edits per run
-- Keep F10 (export_all.lua) read-only; this is the only script bound to a hotkey that writes.
-- ============================================================

require 'imports/other/helpers'
local json = require 'imports/external/json'

-- ---------- ACTIONS: release loaned-out players ----------
-- The app's Transfer Hub "Release" button queues { type = "release_loaned", player_id } actions in
-- C:\Users\Public\ea_fc_player_actions_pending.json. For each one (max 10 per run) this:
--   1. requires a playerloans row loaned out BY YOUR CLUB (never touches other clubs' players)
--   2. ends the loan (TerminateLoan: the player returns to your club) and checks the loan row is gone
--   3. checks the player is now on your club's teamplayerlinks, then releases him (ReleasePlayerFromTeam,
--      i.e. to the free-agent pool) and checks he is no longer on your club
-- Every step is pcall'd and verified; results go to ea_fc_player_actions_result.json. Silent no-op when
-- no actions are queued. BACK UP YOUR SAVE: both calls are marked "can damage your save" in Live Editor's docs.
local function run_actions()
    local IN_PATH = "C:\\Users\\Public\\ea_fc_player_actions_pending.json"
    local OUT_PATH = "C:\\Users\\Public\\ea_fc_player_actions_result.json"
    local MAX_ACTIONS = 10

    local fin = io.open(IN_PATH, "r")
    if not fin then return end
    local raw = fin:read("*a")
    fin:close()

    local results = {}
    local function finish()
        local f = io.open(OUT_PATH, "w+")
        if f then f:write(json.encode({ results = results })); f:close() end
        pcall(os.remove, IN_PATH)
    end

    local okParse, data = pcall(json.decode, raw)
    if not okParse or type(data) ~= "table" or type(data.actions) ~= "table" then
        Log("[PlayerEditorSync] actions: pending file is not valid")
        finish()
        return
    end
    if not IsInCM() then
        for _, a in ipairs(data.actions) do table.insert(results, { player_id = a.player_id, ok = false, error = "not in career mode" }) end
        finish()
        return
    end

    local okU, user_team_id = pcall(GetUserTeamID)
    local loans = LE.db:GetTable("playerloans")
    local links = LE.db:GetTable("teamplayerlinks")

    local function loan_row_team(pid)  -- teamidloanedfrom of this player's loan row, or nil
        if not loans then return nil end
        local rec, n = loans:GetFirstRecord(), 0
        while rec and rec > 0 and n < 20000 do
            n = n + 1
            local okp, p = pcall(loans.GetRecordFieldValue, loans, rec, "playerid")
            if okp and p == pid then
                local okt, t = pcall(loans.GetRecordFieldValue, loans, rec, "teamidloanedfrom")
                return okt and t or -1
            end
            rec = loans:GetNextValidRecord()
        end
        return nil
    end
    local function is_at_team(pid, team)
        if not links then return false end
        local rec, n = links:GetFirstRecord(), 0
        while rec and rec > 0 and n < 60000 do
            n = n + 1
            local okp, p = pcall(links.GetRecordFieldValue, links, rec, "playerid")
            if okp and p == pid then
                local okt, t = pcall(links.GetRecordFieldValue, links, rec, "teamid")
                if okt and t == team then return true end
            end
            rec = links:GetNextValidRecord()
        end
        return false
    end

    for i, a in ipairs(data.actions) do
        if i > MAX_ACTIONS then break end
        local pid = a.player_id
        local function res(ok, err)
            Log(string.format("[PlayerEditorSync] release %s: %s %s", tostring(pid), ok and "OK" or "FAILED", err or ""))
            table.insert(results, { action_id = a.action_id, player_id = pid, ok = ok, error = err })
        end
        if a.type ~= "release_loaned" or type(pid) ~= "number" then
            res(false, "unknown action")
        elseif not okU or not user_team_id or user_team_id <= 0 then
            res(false, "could not determine your club")
        else
            local loanedFrom = loan_row_team(pid)
            if loanedFrom == nil then
                res(false, "no loan record for this player (already cleared; refresh the app)")
            elseif loanedFrom ~= user_team_id then
                res(false, "player is not loaned out by your club")
            elseif type(TerminateLoan) ~= "function" or type(ReleasePlayerFromTeam) ~= "function" then
                res(false, "TerminateLoan/ReleasePlayerFromTeam are not available in this Live Editor version")
            else
                local okT, errT = pcall(TerminateLoan, pid)
                if not okT then
                    res(false, "TerminateLoan failed: " .. tostring(errT))
                elseif loan_row_team(pid) ~= nil then
                    res(false, "loan still active after TerminateLoan")
                elseif not is_at_team(pid, user_team_id) then
                    res(false, "loan ended but the player is not at your club, so he was NOT released")
                else
                    local okR, errR = pcall(ReleasePlayerFromTeam, pid)
                    if not okR then res(false, "loan ended, release failed: " .. tostring(errR))
                    elseif is_at_team(pid, user_team_id) then res(false, "loan ended, but the release did not take effect")
                    else res(true, nil) end
                end
            end
        end
    end
    finish()
end

local function run_apply()
local IN_PATH = "C:\\Users\\Public\\ea_fc_player_edits_pending.json"
local OUT_JSON = "C:\\Users\\Public\\ea_fc_player_edits_write_log.json"
local OUT_TXT = "C:\\Users\\Public\\ea_fc_player_edits_write_log.txt"
local MAX_EDITS_PER_RUN = 25 -- hard cap; matches MAX_EDITS_PER_RUN in player_editor.js

-- KEEP IN SYNC with FIELD_LIMITS in player_editor.js. { min, max } inclusive integers.
local FIELD_LIMITS = {
    overallrating = { 1, 99 }, potential = { 1, 99 },
    preferredposition1 = { 0, 27 },
    preferredposition2 = { -1, 27 }, preferredposition3 = { -1, 27 }, preferredposition4 = { -1, 27 },
    preferredposition5 = { -1, 27 }, preferredposition6 = { -1, 27 },
    trait1 = { 0, 1073741823 }, trait2 = { 0, 8191 }, icontrait1 = { 0, 1073741823 }, icontrait2 = { 0, 63 },
    skintonecode = { 10, 100 }, skincomplexion = { 1, 10 }, skintypecode = { 0, 7 },
    hairtypecode = { 0, 2100 }, haircolorcode = { 0, 27 },
    facialhairtypecode = { 0, 400 }, facialhaircolorcode = { 0, 27 },
    eyecolorcode = { 1, 10 }, eyedetail = { 0, 6 }, eyebrowcode = { 0, 3000000 },
    accessorycode1 = { 0, 1100 }, accessorycode2 = { 0, 1100 }, accessorycode3 = { 0, 1100 }, accessorycode4 = { 0, 1100 },
    accessorycolourcode1 = { 0, 99 }, accessorycolourcode2 = { 0, 99 }, accessorycolourcode3 = { 0, 99 }, accessorycolourcode4 = { 0, 99 },
    bodytypecode = { 1, 11 }, height = { 140, 220 }, weight = { 40, 120 },
    shoetypecode = { 0, 562 },
    jerseyfit = { 0, 2 }, jerseysleevelengthcode = { 0, 4 }, jerseystylecode = { 0, 1 }, socklengthcode = { 0, 3 },
}
local ATTRIBUTES = {
    "crossing", "finishing", "headingaccuracy", "shortpassing", "volleys", "dribbling", "curve",
    "freekickaccuracy", "longpassing", "ballcontrol", "acceleration", "sprintspeed", "agility",
    "reactions", "balance", "shotpower", "jumping", "stamina", "strength", "longshots",
    "aggression", "interceptions", "positioning", "vision", "penalties", "composure",
    "defensiveawareness", "standingtackle", "slidingtackle",
    "gkdiving", "gkhandling", "gkkicking", "gkpositioning", "gkreflexes",
}
local IS_ATTRIBUTE = {}
for _, a in ipairs(ATTRIBUTES) do
    FIELD_LIMITS[a] = { 1, 99 }
    IS_ATTRIBUTE[a] = true
end

local pending_probe = io.open(IN_PATH, "r")
if not pending_probe then return end
pending_probe:close()

local logFile = io.open(OUT_TXT, "w")
local function log(line)
    Log(line)
    if logFile then logFile:write(line .. "\n"); logFile:flush() end
end

local results = {}
local function finish()
    local f = io.open(OUT_JSON, "w+")
    if f then f:write(json.encode({ results = results })); f:close() end
    if logFile then logFile:close() end
    pcall(os.remove, IN_PATH) -- consumed: every edit now has a result in the write log
end

log("=== Player editor write-back started ===")

if not IsInCM() then
    log("ABORT: not in career mode.")
    finish()
    return
end

local function readFile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local c = f:read("*a")
    f:close()
    return c
end

local raw = readFile(IN_PATH)
if not raw then
    log("ABORT: no pending file at " .. IN_PATH)
    finish()
    return
end
local okParse, data = pcall(json.decode, raw)
if not okParse or type(data) ~= "table" or type(data.edits) ~= "table" then
    log("ABORT: pending file is not valid JSON with an edits array.")
    finish()
    return
end

local players_table = LE.db:GetTable("players")
if not players_table then
    log("ABORT: players table missing.")
    finish()
    return
end

-- ---------- bit helpers (no bit library) ----------
local function popcount(v)
    local n = 0
    while v > 0 do n = n + (v % 2); v = math.floor(v / 2) end
    return n
end
local function shares_bit(a, b)
    while a > 0 and b > 0 do
        if (a % 2 == 1) and (b % 2 == 1) then return true end
        a = math.floor(a / 2); b = math.floor(b / 2)
    end
    return false
end

local function read(rec, field)
    local ok, v = pcall(players_table.GetRecordFieldValue, players_table, rec, field)
    if ok then return v end
    return nil
end

-- 1. work out which edits this run handles and find their player records in ONE pass
local edits, wanted, wantedCount = {}, {}, 0
for i, e in ipairs(data.edits) do
    if i > MAX_EDITS_PER_RUN then
        log("cap reached: edits beyond " .. MAX_EDITS_PER_RUN .. " are left for the next run")
        break
    end
    table.insert(edits, e)
    if e.player_id and not wanted[e.player_id] then wanted[e.player_id] = true; wantedCount = wantedCount + 1 end
end

local recFor = {}
do
    local rec, scanned, found = players_table:GetFirstRecord(), 0, 0
    while rec and rec > 0 and scanned < 30000 and found < wantedCount do
        scanned = scanned + 1
        local pid = read(rec, "playerid")
        if pid and wanted[pid] and not recFor[pid] then recFor[pid] = rec; found = found + 1 end
        rec = players_table:GetNextValidRecord()
    end
end

-- 2. apply each edit
for _, e in ipairs(edits) do
    local pid = e.player_id
    local function fail(msg)
        log(string.format("edit %s player %s FAILED: %s", tostring(e.edit_id), tostring(pid), msg))
        table.insert(results, { edit_id = e.edit_id, ok = false, error = msg })
    end

    local rec = pid and recFor[pid]
    if not rec then
        fail("player record not found")
    elseif type(e.new) ~= "table" or type(e.old) ~= "table" then
        fail("malformed edit")
    elseif read(rec, "hashighqualityhead") ~= 0 then
        fail("player has a scanned/real head; only generic players are editable")
    else
        local problem = nil
        local merged = {}
        -- validate every column and the drift check BEFORE writing anything
        for field, newVal in pairs(e.new) do
            local lim = FIELD_LIMITS[field]
            if not lim then problem = "column not editable: " .. field; break end
            if type(newVal) ~= "number" or newVal ~= math.floor(newVal) or newVal < lim[1] or newVal > lim[2] then
                problem = "value out of range for " .. field .. ": " .. tostring(newVal); break
            end
            local cur = read(rec, field)
            if cur == nil then problem = "column missing in this game version: " .. field; break end
            if cur ~= newVal and cur ~= e.old[field] then
                problem = string.format("game value drifted for %s (game=%s, expected=%s)", field, tostring(cur), tostring(e.old[field]))
                break
            end
            merged[field] = newVal
        end

        if not problem then
            -- rule checks on the final merged state (fall back to the game's value for untouched columns)
            local function final(field) return merged[field] ~= nil and merged[field] or read(rec, field) or 0 end
            if merged.trait1 or merged.trait2 or merged.icontrait1 or merged.icontrait2 then
                if shares_bit(final("trait1"), final("icontrait1")) or shares_bit(final("trait2"), final("icontrait2")) then
                    problem = "a playstyle cannot be both base and PlayStyle+"
                elseif popcount(final("icontrait1")) + popcount(final("icontrait2")) > 1 then
                    problem = "at most one PlayStyle+ per player"
                end
            end
            if not problem then
                local touchedPos = false
                for f in pairs(merged) do if string.sub(f, 1, 17) == "preferredposition" then touchedPos = true end end
                if touchedPos then
                    local seen = { [final("preferredposition1")] = true }
                    for n = 2, 6 do
                        local p = final("preferredposition" .. n)
                        if p >= 0 then
                            if seen[p] then problem = "positions must be unique"; break end
                            seen[p] = true
                        end
                    end
                end
            end
        end

        if problem then
            fail(problem)
        else
            -- write
            local writeErr = nil
            for field, newVal in pairs(merged) do
                local okW, errW = pcall(players_table.SetRecordFieldValue, players_table, rec, field, newVal)
                if not okW then writeErr = "write failed for " .. field .. ": " .. tostring(errW); break end
                if IS_ATTRIBUTE[field] then
                    -- only players with a development plan accept this; harmless otherwise
                    pcall(PlayerSetValueInDevelopementPlan, pid, field, newVal)
                end
            end
            -- read back
            if not writeErr then
                for field, newVal in pairs(merged) do
                    local back = read(rec, field)
                    if back ~= newVal then
                        writeErr = string.format("read-back mismatch for %s (wrote %s, game has %s)", field, tostring(newVal), tostring(back))
                        break
                    end
                end
            end
            if writeErr then
                fail(writeErr)
            else
                local n = 0
                for _ in pairs(merged) do n = n + 1 end
                log(string.format("edit %s player %s OK (%d columns)", tostring(e.edit_id), tostring(pid), n))
                table.insert(results, { edit_id = e.edit_id, ok = true })
            end
        end
    end
end

log("=== done: " .. #results .. " of " .. #edits .. " edits processed ===")
finish()

end

local function run_export()
local OUT_PATH = "C:\\Users\\Public\\ea_fc_player_editor_export.json"
local LOG_PATH = "C:\\Users\\Public\\ea_fc_player_editor_export_log.txt"
local MAX_PLAYERS = 150   -- user squad + academy is well under this
local MAX_SCAN = 30000

local logFile = io.open(LOG_PATH, "w")
local function log(line)
    if logFile then logFile:write(line .. "\n"); logFile:flush() end
end

if not IsInCM() then
    log("ABORT: not in career mode.")
    if logFile then logFile:close() end
    return
end

-- every field this export reads; missing ones are skipped (and logged) at runtime
local FIELDS = {
    -- identity / ratings
    "playerid", "overallrating", "potential", "modifier",
    "preferredposition1", "preferredposition2", "preferredposition3",
    "preferredposition4", "preferredposition5", "preferredposition6",
    -- playstyles
    "trait1", "trait2", "icontrait1", "icontrait2",
    -- appearance
    "skintonecode", "skincomplexion", "skintypecode",
    "hairtypecode", "haircolorcode", "facialhairtypecode", "facialhaircolorcode",
    "eyecolorcode", "eyedetail", "eyebrowcode",
    "accessorycode1", "accessorycode2", "accessorycode3", "accessorycode4",
    "accessorycolourcode1", "accessorycolourcode2", "accessorycolourcode3", "accessorycolourcode4",
    "bodytypecode", "height", "weight",
    "shoetypecode", "jerseyfit", "jerseysleevelengthcode", "jerseystylecode", "socklengthcode",
    "headassetid", "headtypecode", "headclasscode", "hashighqualityhead",
    -- attributes (outfield + GK)
    "crossing", "finishing", "headingaccuracy", "shortpassing", "volleys", "dribbling", "curve",
    "freekickaccuracy", "longpassing", "ballcontrol", "acceleration", "sprintspeed", "agility",
    "reactions", "balance", "shotpower", "jumping", "stamina", "strength", "longshots",
    "aggression", "interceptions", "positioning", "vision", "penalties", "composure",
    "defensiveawareness", "standingtackle", "slidingtackle",
    "gkdiving", "gkhandling", "gkkicking", "gkpositioning", "gkreflexes",
}

local players_table = LE.db:GetTable("players")
if not players_table then
    log("ABORT: players table missing")
    if logFile then logFile:close() end
    return
end

local present = {}
for _, f in ipairs(FIELDS) do
    if players_table.fields[f] then
        table.insert(present, f)
    else
        log("field missing (skipped): " .. f)
    end
end

-- 1. which player ids to export
local wanted, order = {}, {}
local function want(pid, source)
    if pid and pid > 0 and not wanted[pid] and #order < MAX_PLAYERS then
        wanted[pid] = source
        table.insert(order, pid)
    end
end

local user_team_id = 0
do
    local ok, id = pcall(GetUserTeamID)
    if ok and id then user_team_id = id end
end
log("user team id: " .. tostring(user_team_id))

local tpl = LE.db:GetTable("teamplayerlinks")
if tpl and user_team_id > 0 then
    local rec, n = tpl:GetFirstRecord(), 0
    while rec and rec > 0 and n < MAX_SCAN do
        n = n + 1
        local ok, team = pcall(tpl.GetRecordFieldValue, tpl, rec, "teamid")
        if ok and team == user_team_id then
            local ok2, pid = pcall(tpl.GetRecordFieldValue, tpl, rec, "playerid")
            if ok2 then want(pid, "squad") end
        end
        rec = tpl:GetNextValidRecord()
    end
end

local youth = LE.db:GetTable("career_youthplayers")
if youth then
    local rec, n = youth:GetFirstRecord(), 0
    while rec and rec > 0 and n < 500 do
        n = n + 1
        local ok, pid = pcall(youth.GetRecordFieldValue, youth, rec, "playerid")
        if ok then want(pid, "academy") end
        rec = youth:GetNextValidRecord()
    end
end
log("players wanted: " .. #order)

-- 2. read their rows in one pass over players
local out = {}
local rec, scanned, found = players_table:GetFirstRecord(), 0, 0
while rec and rec > 0 and scanned < MAX_SCAN and found < #order do
    scanned = scanned + 1
    local ok, pid = pcall(players_table.GetRecordFieldValue, players_table, rec, "playerid")
    if ok and pid and wanted[pid] then
        found = found + 1
        local row = { source = wanted[pid] }
        for _, f in ipairs(present) do
            local okf, v = pcall(players_table.GetRecordFieldValue, players_table, rec, f)
            if okf then row[f] = v end
        end
        row.editable = (row.hashighqualityhead == 0)
        local okn, name = pcall(GetPlayerName, pid)
        row.name = okn and name or ""
        table.insert(out, row)
        log(string.format("read %d %s (%s) editable=%s", pid, row.name, wanted[pid], tostring(row.editable)))
    end
    rec = players_table:GetNextValidRecord()
end

local save_uid = ""
do
    local okS, uid = pcall(GetSaveUID)
    if okS and uid then save_uid = tostring(uid) end
end

local f = io.open(OUT_PATH, "w+")
if f then
    f:write(json.encode({ save_uid = save_uid, team_id = user_team_id, players = out }))
    f:close()
    log(string.format("wrote %d players to %s", #out, OUT_PATH))
else
    log("FAILED to open " .. OUT_PATH)
end
if logFile then logFile:close() end
print("[PlayerEditorExport] done: " .. #out .. " players")

end

local okX, errX = pcall(run_actions)
if not okX then Log("[PlayerEditorSync] actions step crashed: " .. tostring(errX)) end
local okA, errA = pcall(run_apply)
if not okA then Log("[PlayerEditorSync] apply step crashed: " .. tostring(errA)) end
local okE, errE = pcall(run_export)
if not okE then Log("[PlayerEditorSync] export step crashed: " .. tostring(errE)) end
