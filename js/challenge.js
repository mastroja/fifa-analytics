// Challenge Mode — the single source of truth behind every Challenge
// entry point (Home card, slide-over drawer, header chip, Transfers Hub
// banners). Pure functions only: no DOM, no IPC, no globals from app.js,
// so the same numbers are guaranteed everywhere and the logic is testable
// in plain Node (see the module.exports guard at the bottom).
//
// Nothing here is enforced against the game — like the rest of Youth Mode's
// transfer rules, it only tracks what the user has agreed to and flags
// what the captured transfer data says happened.
//
// All dates are ISO "YYYY-MM-DD" strings (in-game dates), compared as
// plain strings, which sorts chronologically for that format.
(function (root) {
  'use strict';

  const SIGNING_CLASSES = ['marquee', 'squad', 'prospect'];

  // ---- date helpers (UTC math so DST never shifts a day) ---------------
  function toDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  }
  function toIso(d) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  function daysBetween(fromIso, toIsoStr) {
    const a = toDate(fromIso), b = toDate(toIsoStr);
    return (a && b) ? Math.round((b - a) / 86400000) : null;
  }
  function addMonths(iso, n) {
    const d = toDate(iso);
    if (!d) return null;
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return toIso(d);
  }

  // Seasons run roughly July -> June, with the summer window opening
  // June 1 (same boundary app.js's getNextTransferWindowStart uses), so
  // "this season's" deals start from the most recent June 1.
  function seasonStartFor(iso) {
    const d = toDate(iso);
    if (!d) return null;
    const year = d.getUTCMonth() + 1 >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    return `${year}-06-01`;
  }
  // The summer window closes Aug 31 — the assumed deadline for sales owed
  // from last season's result (the repo's rules name no explicit date).
  function sellDeadlineFor(seasonStartIso) {
    return `${seasonStartIso.slice(0, 4)}-08-31`;
  }
  function seasonEndFor(iso) {
    const d = toDate(iso);
    const year = d.getUTCMonth() + 1 <= 5 ? d.getUTCFullYear() : d.getUTCFullYear() + 1;
    return `${year}-05-31`;
  }

  // End of the next-or-current transfer window, then the one after, etc.
  // Windows: summer Jun 1 - Aug 31, winter Jan 1 - Jan 31.
  function nextWindowEnd(iso) {
    const d = toDate(iso);
    const m = d.getUTCMonth() + 1, y = d.getUTCFullYear();
    if (m === 1) return `${y}-01-31`;
    if (m >= 2 && m <= 8) return `${y}-08-31`;
    return `${y + 1}-01-31`;
  }
  function windowEndAfter(windowEndIso) {
    const y = +windowEndIso.slice(0, 4);
    return windowEndIso.endsWith('-01-31') ? `${y}-08-31` : `${y + 1}-01-31`;
  }

  // Resolves a ban length the user picked into a concrete end date.
  //   windows — covers N transfer windows (the one you're in counts as 1)
  //   months  — N calendar months from today
  //   seasons — through the end of the current season, plus N-1 more
  function computeBanEnd(todayIso, unit, count) {
    const n = Math.max(1, Math.floor(Number(count) || 1));
    if (!toDate(todayIso)) return null;
    if (unit === 'months') return addMonths(todayIso, n);
    if (unit === 'seasons') {
      const end = seasonEndFor(todayIso);
      return `${+end.slice(0, 4) + n - 1}-05-31`;
    }
    let end = nextWindowEnd(todayIso);
    for (let i = 1; i < n; i++) end = windowEndAfter(end);
    return end;
  }

  // ---- rule text -> structured entitlement -----------------------------
  // YOUTH_TRANSFER_RULES (app.js) is the only place the rules live, so
  // this parses its text instead of duplicating it. Handles all current
  // phrasings, e.g. "1 marquee + 1 squad player", "1 marquee OR 2 squad
  // players (your choice)", "No signings, sell 1 fringe player",
  // "Sell 2 top players, academy intake shrinks". Returns
  // { options: [{marquee, squad, prospect}], sells } — more than one
  // option means the user picks one (OR).
  function parseEntitlement(ruleText) {
    const text = String(ruleText || '');
    const sellMatch = /sell\s+(\d+)/i.exec(text);
    const sells = sellMatch ? +sellMatch[1] : 0;
    const signingPart = text.split(/,/)[0]; // drop ", sell 1 fringe player" etc.
    const options = signingPart.split(/\s+OR\s+/i).map(part => {
      const count = word => {
        const m = new RegExp(`(\\d+)\\s+${word}`, 'i').exec(part);
        return m ? +m[1] : 0;
      };
      return { marquee: count('marquee'), squad: count('squad'), prospect: count('prospect') };
    });
    const hasAny = options.some(o => o.marquee || o.squad || o.prospect);
    return { options: hasAny ? options : [{ marquee: 0, squad: 0, prospect: 0 }], sells };
  }

  // Prospect < league average <= squad <= cap < marquee, matching the
  // "What counts as a …" table in the Youth Rules dialog.
  function classifySigning(overall, bands) {
    if (!bands || overall === null || overall === undefined) return 'squad';
    if (overall < bands.avg) return 'prospect';
    if (bands.max !== null && bands.max !== undefined && overall > bands.max) return 'marquee';
    return 'squad';
  }

  // Greedy slot matching for one option: each class consumes its own
  // slots; anything past that is over-allowance.
  function matchOption(option, usedByClass) {
    const remaining = {}, overflow = {};
    let overflowCount = 0;
    SIGNING_CLASSES.forEach(c => {
      const used = usedByClass[c] || 0;
      remaining[c] = Math.max(option[c] - used, 0);
      overflow[c] = Math.max(used - option[c], 0);
      overflowCount += overflow[c];
    });
    return { remaining, overflow, overflowCount };
  }

  // ---- the one shared status object -------------------------------------
  // input: {
  //   today,               in-game ISO date
  //   club,                user's club name (deals are matched by name)
  //   ruleText,            this season's row from YOUTH_TRANSFER_RULES, or null
  //   outcomeLabel,        that row's label, e.g. "Mid-table"
  //   deals,               [{playerId, name, fromTeam, toTeam, dealType, fee, date}]
  //   bans,                [{id, startDate, endDate, reason, cancelledAt}]
  //   bands,               {avg, max} signing-class cutoffs, or null
  //   overallOf(playerId)  current overall for classifying a signing
  // }
  function computeChallengeStatus(input) {
    const { today, club, ruleText, outcomeLabel, deals = [], bans = [], bands = null, overallOf = () => null } = input;
    const seasonStart = seasonStartFor(today);
    const sellDeadline = seasonStart ? sellDeadlineFor(seasonStart) : null;

    const inSeason = d => d.date && seasonStart && d.date >= seasonStart && d.date <= today;
    const mine = deals.filter(inSeason);
    const incoming = mine.filter(d => d.toTeam === club && d.fromTeam !== club);
    const outgoing = mine.filter(d => d.fromTeam === club && d.toTeam !== club);
    const signedPerms = incoming.filter(d => d.dealType === 'transfer')
      .map(d => ({ ...d, cls: classifySigning(overallOf(d.playerId), bands) }));
    const soldPerms = outgoing.filter(d => d.dealType === 'transfer');

    // ---- ban ----
    const liveBans = bans.filter(b => !b.cancelledAt);
    const activeBan = liveBans.find(b => b.startDate <= today && today <= b.endDate) || null;
    const upcomingBan = liveBans.find(b => b.startDate > today) || null;
    const violations = [];
    liveBans.forEach(b => {
      incoming.filter(d => d.date >= b.startDate && d.date <= b.endDate)
        .forEach(d => violations.push({ ...d, banId: b.id }));
    });
    const ban = {
      active: activeBan,
      upcoming: upcomingBan,
      daysLeft: activeBan ? daysBetween(today, activeBan.endDate) : null,
      elapsedFraction: activeBan
        ? Math.min(1, Math.max(0, daysBetween(activeBan.startDate, today) / Math.max(1, daysBetween(activeBan.startDate, activeBan.endDate))))
        : null,
      violations,
      history: bans
    };

    // ---- entitlement ----
    let signings = null, sells = null;
    if (ruleText) {
      const ent = parseEntitlement(ruleText);
      const used = {};
      SIGNING_CLASSES.forEach(c => { used[c] = signedPerms.filter(s => s.cls === c).length; });
      // pick whichever OR-option the user's actual signings fit best
      let best = null;
      ent.options.forEach(opt => {
        const m = matchOption(opt, used);
        const totalSlots = SIGNING_CLASSES.reduce((n, c) => n + opt[c], 0);
        if (!best || m.overflowCount < best.m.overflowCount) best = { opt, m, totalSlots };
      });
      const earned = best.totalSlots;
      const usedWithinAllowance = earned - SIGNING_CLASSES.reduce((n, c) => n + best.m.remaining[c], 0);
      signings = {
        options: ent.options,
        chosen: best.opt,
        earned,
        used: usedWithinAllowance,
        remaining: best.m.remaining,
        remainingCount: earned - usedWithinAllowance,
        overAllowance: best.m.overflowCount,
        signed: signedPerms,
        hasChoice: ent.options.length > 1
      };
      const sellsDone = soldPerms.length;
      sells = {
        owed: ent.sells,
        done: Math.min(sellsDone, ent.sells),
        remaining: Math.max(ent.sells - sellsDone, 0),
        extra: Math.max(sellsDone - ent.sells, 0),
        sold: soldPerms,
        deadline: sellDeadline,
        daysToDeadline: sellDeadline ? daysBetween(today, sellDeadline) : null,
        overdue: !!(sellDeadline && today > sellDeadline && sellsDone < ent.sells)
      };
    }

    // ---- banners / chip / headline (priority order) ----
    const banners = [];
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const canSign = signings && signings.remainingCount > 0 && !ban.active;
    const unspentSigningText = () => {
      const parts = SIGNING_CLASSES.filter(c => signings.remaining[c] > 0).map(c => plural(signings.remaining[c], c));
      return parts.join(' + ');
    };

    if (violations.length) {
      banners.push({ tone: 'danger', text: `Transfer ban broken: ${violations.map(v => v.name || 'a player').join(', ')} signed during the ban.` });
    }
    if (ban.active) {
      banners.push({ tone: 'danger', text: `Transfer ban active — no signings for ${plural(ban.daysLeft, 'more day')} (until ${ban.active.endDate}).` });
    }
    if (sells && sells.overdue) {
      banners.push({ tone: 'danger', text: `Overdue: ${plural(sells.remaining, 'player')} should have been sold by ${sells.deadline}.` });
    } else if (sells && sells.remaining > 0) {
      banners.push({ tone: 'warn', text: `Sell ${sells.remaining} ${sells.remaining === 1 ? 'player' : 'players'} by ${sells.deadline}${sells.daysToDeadline >= 0 ? ` (${plural(sells.daysToDeadline, 'day')} left)` : ''}.` });
    }
    if (canSign) {
      banners.push({ tone: 'good', text: `You've earned ${plural(signings.remainingCount, 'signing')}: ${unspentSigningText()}${signings.hasChoice ? ' (or the alternative option)' : ''}.` });
    }
    if (signings && signings.overAllowance > 0) {
      banners.push({ tone: 'danger', text: `${plural(signings.overAllowance, 'signing')} beyond this season's allowance.` });
    }

    let chip = null, headline;
    if (violations.length) {
      chip = { tone: 'danger', text: '🚫 Ban broken' };
    } else if (ban.active) {
      chip = { tone: 'danger', text: `🚫 Transfer ban · ${ban.daysLeft}d left` };
    } else if (sells && sells.overdue) {
      chip = { tone: 'danger', text: `${plural(sells.remaining, 'player')} overdue to sell` };
    } else if (sells && sells.remaining > 0) {
      chip = { tone: 'warn', text: `${plural(sells.remaining, 'player')} to sell` };
    } else if (canSign) {
      chip = { tone: 'good', text: `${plural(signings.remainingCount, 'signing')} available` };
    }

    const totalObligations = (signings ? signings.earned : 0) + (sells ? sells.owed : 0);
    const doneObligations = (signings ? signings.used : 0) + (sells ? sells.done : 0);
    if (violations.length) {
      headline = { kind: 'ban-broken', tone: 'danger', title: 'Transfer ban broken', detail: `${plural(violations.length, 'signing')} made while banned.`, progress: { done: 0, total: 1, label: 'Ban violated' } };
    } else if (ban.active) {
      headline = { kind: 'ban', tone: 'danger', title: `Transfer ban: ${plural(ban.daysLeft, 'day')} left`, detail: `No signings until ${ban.active.endDate}${ban.active.reason ? ` — ${ban.active.reason}` : ''}.`, progress: { done: Math.round(ban.elapsedFraction * 100), total: 100, label: `${Math.round(ban.elapsedFraction * 100)}% served` } };
    } else if (sells && sells.overdue) {
      headline = { kind: 'sell-overdue', tone: 'danger', title: `${plural(sells.remaining, 'sale')} overdue`, detail: `Should have been done by ${sells.deadline}.`, progress: { done: doneObligations, total: totalObligations, label: `${doneObligations}/${totalObligations} obligations done` } };
    } else if (sells && sells.remaining > 0) {
      headline = { kind: 'sell', tone: 'warn', title: `Sell ${plural(sells.remaining, 'player')}`, detail: `Due by ${sells.deadline}${outcomeLabel ? ` · from "${outcomeLabel}"` : ''}.`, progress: { done: doneObligations, total: totalObligations, label: `${doneObligations}/${totalObligations} obligations done` } };
    } else if (canSign) {
      headline = { kind: 'sign', tone: 'good', title: `${plural(signings.remainingCount, 'signing')} available`, detail: unspentSigningText() + (signings.hasChoice ? ' (or the alternative)' : ''), progress: { done: doneObligations, total: totalObligations, label: `${doneObligations}/${totalObligations} obligations done` } };
    } else if (ruleText) {
      headline = { kind: 'clear', tone: 'neutral', title: 'All clear', detail: 'No signings or sales outstanding this season.', progress: { done: totalObligations || 1, total: totalObligations || 1, label: 'Season complete' } };
    } else {
      headline = { kind: 'none', tone: 'neutral', title: 'No season result yet', detail: 'Signing and sale rules appear once last season has a recorded result.', progress: null };
    }

    return { today, seasonStart, outcomeLabel: outcomeLabel || null, ruleText: ruleText || null, signings, sells, ban, headline, chip, banners };
  }

  const api = {
    parseEntitlement, classifySigning, computeBanEnd, computeChallengeStatus,
    seasonStartFor, sellDeadlineFor, daysBetween, addMonths
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Challenge = api;
})(typeof window !== 'undefined' ? window : globalThis);
