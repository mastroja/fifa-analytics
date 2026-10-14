-- ============================================================
-- FC 27 TRANSFER HISTORY API — is the v27.1.4 "Transfer History" feature scriptable?
--
-- v27.1.4 added a Transfer History view (with undo, CPU transfers only) to Live Editor.
-- If it is backed by a Lua-visible API we could rebuild export_transfers.lua on it
-- instead of the FC 26 memory offsets (which are wrong in FC 27).
--
-- SAFETY: the "transfers" / "transferhistory" DB tables crashed GetFirstRecord() three
-- times in FC 26 (see export_transfers.lua header). This probe therefore NEVER reads
-- rows from any table. It only:
--   1. lists the keys of the global tables LE / LE.* and the Lua globals whose names
--      mention transfer / history / undo (type() and names only, nothing is called),
--   2. lists DB table names and field NAMES that mention transfer (metadata only).
-- A follow-up probe can call a specific function once we know its name and signature.
--
-- Run via Live Editor's Lua Engine (NOT bound to F10), with a career save loaded.
-- Report: %USERPROFILE%\Desktop\FC Tests\LE_FC27_transfer_history_report.txt
-- ============================================================

require 'imports/other/helpers'

local report = {}
local out_path = os.getenv("USERPROFILE") .. "\\Desktop\\FC Tests\\LE_FC27_transfer_history_report.txt"
local function flush_report()
    local f = io.open(out_path, "w+")
    if f then f:write(table.concat(report, "\n")); f:close() end
end
local function log(line) table.insert(report, line); flush_report() end

local PATTERNS = { "transfer", "histor", "undo", "revert", "deal", "negotiat" }
local function interesting(name)
    local l = tostring(name):lower()
    for _, p in ipairs(PATTERNS) do
        if l:find(p, 1, true) then return true end
    end
    return false
end

local function sorted_keys(t)
    local keys = {}
    for k in pairs(t) do table.insert(keys, k) end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    return keys
end

-- Lists every key of a table (name + type only). Metatable __index tables are included,
-- since Live Editor objects usually expose their methods that way.
local function dump_keys(label, t)
    log("---- " .. label .. " (" .. type(t) .. ") ----")
    if type(t) ~= "table" then return end
    local seen, count = {}, 0
    local function walk(tbl)
        for _, k in ipairs(sorted_keys(tbl)) do
            if not seen[k] then
                seen[k] = true
                count = count + 1
                local flag = interesting(k) and "   <== MATCH" or ""
                log(string.format("  %-40s %s%s", tostring(k), type(tbl[k]), flag))
            end
        end
    end
    walk(t)
    local mt = getmetatable(t)
    if type(mt) == "table" and type(mt.__index) == "table" then
        log("  (metatable __index)")
        walk(mt.__index)
    end
    log("  " .. count .. " keys")
end

log("==== Live Editor version hint ====")
log("  LE: " .. type(LE))
if type(LE) == "table" then
    for _, k in ipairs({ "version", "VERSION", "Version" }) do
        if LE[k] ~= nil then log("  LE." .. k .. " = " .. tostring(LE[k])) end
    end
end

log("")
log("==== 1. Lua globals mentioning transfer / history / undo ====")
local hits = 0
for _, k in ipairs(sorted_keys(_G)) do
    if interesting(k) then
        hits = hits + 1
        log(string.format("  %-40s %s", tostring(k), type(_G[k])))
    end
end
log("  " .. hits .. " matching globals")

log("")
log("==== 2. LE and its sub-objects ====")
if type(LE) == "table" then
    dump_keys("LE", LE)
    for _, k in ipairs(sorted_keys(LE)) do
        local v = LE[k]
        if type(v) == "table" and (interesting(k) or k == "db" or k == "game" or k == "career") then
            dump_keys("LE." .. tostring(k), v)
        end
    end
end

log("")
log("==== 3. DB tables / fields mentioning transfer (names only, NO rows read) ====")
if type(GetDBTablesNames) == "function" then
    local ok, names = pcall(GetDBTablesNames)
    if ok and type(names) == "table" then
        for _, nm in ipairs(names) do
            if interesting(nm) then
                log("  TABLE " .. tostring(nm))
                if type(GetDBTableFields) == "function" then
                    local ok2, fields = pcall(GetDBTableFields, nm)
                    if ok2 and type(fields) == "table" then
                        local fn = {}
                        for k, v in pairs(fields) do
                            table.insert(fn, type(k) == "string" and k or tostring(v))
                        end
                        table.sort(fn)
                        log("    fields: " .. table.concat(fn, ", "))
                    else
                        log("    GetDBTableFields: " .. tostring(fields))
                    end
                end
            end
        end
    else
        log("  GetDBTablesNames failed: " .. tostring(names))
    end
else
    log("  GetDBTablesNames: " .. type(GetDBTablesNames))
end

log("")
log("==== DONE ====")
print("FC27 transfer history probe report written to " .. out_path)
