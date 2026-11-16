#!/usr/bin/env node
// Checks for the swooping spot rules (lib/swoop-core.ts) and their storage
// (lib/store.ts), runnable in bare node:
//
//   node web/tools/check.mjs
//
// A Karoo trusts whatever the service sends, so these prove what it sends: a
// report joins the spot it belongs to, a resent tap counts once, the season and
// the keep-seasons rule decide what is live, a stranger's report must be recent
// and in Australia, and the answer stays under the Karoo relay's cap.
//
// The storage runs against node's own SQLite behind a stand-in with the same
// shape as Cloudflare D1, on the real schema.sql.

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  confirmsHeld, forKaroo, forMap, haversineM, inAustralia, inSeason, isKnown, isLive, liveSpots, localYearMonth,
  plausibleReport, validReport, MAX_SPOTS,
} from "../lib/swoop-core.ts";
import {
  DEFAULTS, addReport, allSpots, approveSpot, quietSpot, readSettings, removeReport, removeSpot, renameSpot, rulesFrom,
  settingProblem, spotsNear, wakeSpot, withinLimit, writeSetting,
} from "../lib/store.ts";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
  if (!ok) failures++;
}

// node's SQLite, dressed as D1: prepare().bind().first() / all() / run().
function d1(sqlite) {
  return {
    prepare(sql) {
      const make = (args) => ({
        bind: (...more) => make(more),
        first: async () => sqlite.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        run: async () => {
          const r = sqlite.prepare(sql).run(...args);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      });
      return make([]);
    },
  };
}
const schema = await readFile(resolve(WEB, "schema.sql"), "utf8");
function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  return { db: d1(sqlite), sqlite };
}

const RULES = { alerts: true, seasonMonths: [8, 9, 10, 11], keepSeasons: 2, mergeM: 150 };
const HERE = { lat: -35.3, lng: 149.1 }; // central Canberra
const north = (m) => ({ lat: HERE.lat + m / 111_320, lng: HERE.lng });
const tap = (uid, pos, at, extra = {}) => ({ install: "install-1", ...pos, at, source: "karoo", uid, ...extra });

console.log("distance");
check("100 m north measures 100 m", Math.abs(haversineM(HERE.lat, HERE.lng, north(100).lat, HERE.lng) - 100) < 0.5);
check("same point measures 0", haversineM(HERE.lat, HERE.lng, HERE.lat, HERE.lng) === 0);

console.log("reports and spots");
{
  const { db, sqlite } = freshDb();
  const first = await addReport(db, tap("tap-aaaaaaa1", HERE, "2026-10-01T22:00:00Z"), RULES.mergeM);
  check("first report makes a spot", first.created && !first.repeat && first.spot.reports === 1);

  const again = await addReport(db, tap("tap-aaaaaaa1", HERE, "2026-10-01T22:00:00Z"), RULES.mergeM);
  check("the same tap resent counts once", again.repeat && again.spot.reports === 1 && (await allSpots(db)).length === 1);

  const near = await addReport(db, tap("tap-aaaaaaa2", north(120), "2026-10-09T22:00:00Z", { install: "install-2" }), RULES.mergeM);
  check("a report 120 m away joins the spot", !near.created && near.spot.id === first.spot.id && near.spot.reports === 2);
  check("the spot stays where it was first reported", near.spot.lat === HERE.lat);
  check("last report moves forward", near.spot.last_report === "2026-10-09T22:00:00.000Z");

  const early = await addReport(db, tap("tap-aaaaaaa3", north(40), "2026-09-01T22:00:00Z"), RULES.mergeM);
  check("an older report moves first report back, not last", early.spot.first_report === "2026-09-01T22:00:00.000Z"
    && early.spot.last_report === "2026-10-09T22:00:00.000Z");

  const far = await addReport(db, tap("tap-aaaaaaa4", north(400), "2026-10-10T22:00:00Z"), RULES.mergeM);
  check("a report 400 m away makes a second spot", far.created && (await allSpots(db)).length === 2);

  const between = await addReport(db, tap("tap-aaaaaaa5", north(300), "2026-10-11T22:00:00Z"), RULES.mergeM);
  check("a report between two spots joins the nearer", between.spot.id === far.spot.id);

  const east = await addReport(db, tap("tap-aaaaaaa7", { lat: HERE.lat, lng: HERE.lng + 140 / 90_800 }, "2026-10-11T23:00:00Z"), RULES.mergeM);
  check("a report 140 m east joins the spot too", !east.created && east.spot.id === first.spot.id);

  const reports = sqlite.prepare("SELECT COUNT(*) AS n FROM reports").get().n;
  check("every distinct report is kept", reports === 6, `${reports} rows`);

  const named = await addReport(db, { install: null, ...north(2000), at: "2026-10-12T00:00:00Z", source: "hand", uid: "hand-bbbbbbb1", name: "  Northbourne Ave  " }, RULES.mergeM);
  check("a hand spot keeps its trimmed name", named.spot.name === "Northbourne Ave");
  await renameSpot(db, named.spot.id, "  Haig Park  ");
  check("a spot can be renamed", (await allSpots(db)).find((s) => s.id === named.spot.id).name === "Haig Park");

  const now = new Date("2026-10-15T00:00:00Z");
  await removeSpot(db, first.spot.id);
  check("a removed spot is not live", !isLive((await allSpots(db)).find((s) => s.id === first.spot.id), now, RULES));
  check("a removed spot is not sent to a Karoo", !(await spotsNear(db, HERE, 3)).some((s) => s.id === first.spot.id));
  const back = await addReport(db, tap("tap-aaaaaaa6", HERE, "2026-10-14T22:00:00Z"), RULES.mergeM);
  check("a fresh report brings a removed spot back", back.spot.id === first.spot.id && back.spot.status === "active" && !back.created);

  await quietSpot(db, far.spot.id, now);
  const quiet = (await allSpots(db)).find((s) => s.id === far.spot.id);
  check("quiet holds for this season", quiet.status === "quiet" && !isLive(quiet, now, RULES));
  check("quiet lapses next season", isLive(quiet, new Date("2027-09-15T00:00:00Z"), RULES));
  await wakeSpot(db, far.spot.id);
  check("wake makes it live again", isLive((await allSpots(db)).find((s) => s.id === far.spot.id), now, RULES));

  check("a spot 500 km away is outside a Karoo's box", !(await spotsNear(db, { lat: HERE.lat + 4.5, lng: HERE.lng }, 3)).length);
}

console.log("what counts as live");
{
  const spot = (last, extra = {}) => ({ id: 1, lat: HERE.lat, lng: HERE.lng, name: null, status: "active",
    quiet_season: null, first_report: last, last_report: last, reports: 1, ...extra });
  const oct26 = new Date("2026-10-15T00:00:00Z");
  check("in season, reported this year: live", isLive(spot("2026-09-20T00:00:00Z"), oct26, RULES));
  check("in season, reported last year: live (keep 2)", isLive(spot("2025-10-20T00:00:00Z"), oct26, RULES));
  check("reported two years back: not live (keep 2)", !isLive(spot("2024-10-20T00:00:00Z"), oct26, RULES));
  check("keep 1 drops last year's", !isLive(spot("2025-10-20T00:00:00Z"), oct26, { ...RULES, keepSeasons: 1 }));
  const dec = new Date("2026-12-05T00:00:00Z");
  check("December is out of season", !isLive(spot("2026-11-20T00:00:00Z"), dec, RULES));
  check("out of season a spot stays on the map", isKnown(spot("2026-11-20T00:00:00Z"), dec, RULES));
  check("a removed spot is off the map", !isKnown(spot("2026-11-20T00:00:00Z", { status: "removed" }), dec, RULES));
  check("alerts off: nothing is live", !isLive(spot("2026-09-20T00:00:00Z"), oct26, { ...RULES, alerts: false }));
  check("the season turns at local midnight, not UTC",
    inSeason(new Date("2026-07-31T14:30:00Z"), RULES) && !inSeason(new Date("2026-07-31T13:30:00Z"), RULES));
  check("local year and month read in eastern Australian time", (() => {
    const { year, month } = localYearMonth("2026-12-31T13:30:00Z");
    return year === 2027 && month === 1;
  })());
}

console.log("what the Karoo and the map are sent");
{
  const many = Array.from({ length: MAX_SPOTS + 50 }, (_, i) => ({
    id: i + 1, ...north(i * 200), name: null, status: "active", quiet_season: null,
    first_report: "2026-10-01T00:00:00Z", last_report: "2026-10-01T00:00:00Z", reports: 1,
  }));
  const now = new Date("2026-10-15T00:00:00Z");
  const sent = liveSpots(many, now, RULES, north(10_000));
  check(`capped at ${MAX_SPOTS}`, sent.length === MAX_SPOTS);
  check("nearest first", sent[0].id === 51, `first is ${sent[0].id}`);
  check("no farther spot ahead of a nearer one", sent.every((s, i) => i === 0 ||
    haversineM(north(10_000).lat, HERE.lng, s.lat, s.lng) >= haversineM(north(10_000).lat, HERE.lng, sent[i - 1].lat, sent[i - 1].lng)));
  const bytes = Buffer.byteLength(JSON.stringify({ on: true, sync_min: 30, months: [8, 9, 10, 11],
    spots: sent.map((s) => forKaroo({ ...s, name: "A fairly long spot name, forty chars" })) }));
  check("a full answer fits the Karoo relay's 100 KB", bytes < 100_000, `${bytes} bytes`);
  const k = forKaroo({ ...many[0], lat: -35.3012345678, last_report: "2026-11-02T20:00:00Z" });
  check("to a Karoo: positions to five places, dates to the local day", k.lat === -35.30123 && k.last === "2026-11-03");
  const m = forMap({ ...many[0], lat: -35.3012345678, lng: 149.1054321, last_report: "2026-11-02T20:00:00Z", reports: 3 });
  check("to the map: positions to four places, the day, the count",
    m[0] === -35.3012 && m[1] === 149.1054 && m[2] === "2026-11-03" && m[3] === 3 && m[4] === 0 && m.length === 5);
}

console.log("bad reports");
{
  const ok = tap("tap-aaaaaaa9", HERE, "2026-10-01T22:00:00Z");
  check("a good report passes", validReport(ok));
  check("no position fails", !validReport({ ...ok, lat: NaN }));
  check("latitude past 90 fails", !validReport({ ...ok, lat: 123 }));
  check("a short uid fails", !validReport({ ...ok, uid: "x" }));
  check("a bad time fails", !validReport({ ...ok, at: "yesterday" }));

  const now = new Date("2026-10-02T00:00:00Z");
  check("a stranger's report from two hours ago passes", plausibleReport(ok, now));
  check("Hobart and Darwin are in Australia", inAustralia(-42.88, 147.33) && inAustralia(-12.46, 130.84));
  check("Auckland is not", !inAustralia(-36.85, 174.76));
  check("a report from Auckland is refused", !plausibleReport({ ...ok, lat: -36.85, lng: 174.76 }, now));
  check("a report from next week is refused", !plausibleReport({ ...ok, at: "2026-10-09T00:00:00Z" }, now));
  check("a report a Karoo held for a month passes", plausibleReport({ ...ok, at: "2026-09-02T00:00:00Z" }, now));
  check("a report from last year is refused", !plausibleReport({ ...ok, at: "2025-10-01T00:00:00Z" }, now));
}

console.log("website reports are held, and can be taken back");
{
  const { db, sqlite } = freshDb();
  const now = new Date("2026-10-15T00:00:00Z");
  const web = (uid, pos, at, extra = {}) => ({ install: null, ...pos, at, source: "web", uid, activity: "cycling", ...extra });
  const one = await addReport(db, web("web-aaaaaaa1", HERE, "2026-10-10T01:00:00Z"), RULES.mergeM, { hold: true, cancel: "code-1" });
  check("a website report makes a held spot", one.created && one.spot.held === 1);
  check("a held spot warns no Karoo", !isLive(one.spot, now, RULES));
  check("a held spot is still on the map, flagged", isKnown(one.spot, now, RULES) && forMap(one.spot)[4] === 1);
  const again = await addReport(db, web("web-aaaaaaa2", north(30), "2026-10-10T05:00:00Z"), RULES.mergeM, { hold: true, cancel: "code-2" });
  check("a second website report the same day does not confirm it", again.spot.held === 1 && again.spot.reports === 2);
  const later = await addReport(db, web("web-aaaaaaa3", north(20), "2026-10-12T05:00:00Z"), RULES.mergeM, { hold: true, cancel: "code-3" });
  check("a website report on a later day confirms it", later.spot.held === 0 && isLive(later.spot, now, RULES));

  const two = await addReport(db, web("web-bbbbbbb1", north(1000), "2026-10-10T01:00:00Z"), RULES.mergeM, { hold: true, cancel: "code-4" });
  const tapped = await addReport(db, tap("tap-bbbbbbb2", north(1040), "2026-10-10T02:00:00Z"), RULES.mergeM);
  check("a tap from a Karoo confirms a held spot", two.spot.held === 1 && tapped.spot.id === two.spot.id && tapped.spot.held === 0);

  const three = await addReport(db, web("web-ccccccc1", north(2000), "2026-10-10T01:00:00Z"), RULES.mergeM, { hold: true, cancel: "code-5" });
  await approveSpot(db, three.spot.id);
  check("the admin can confirm a held spot", (await allSpots(db)).find((s) => s.id === three.spot.id).held === 0);

  const free = await addReport(db, web("web-ddddddd1", north(3000), "2026-10-10T01:00:00Z"), RULES.mergeM, { hold: false, cancel: "code-6" });
  check("with holding switched off a website report is live at once", free.spot.held === 0);
  const karoo = await addReport(db, tap("tap-eeeeeee1", north(4000), "2026-10-10T01:00:00Z"), RULES.mergeM);
  check("a Karoo's own new spot is never held", karoo.spot.held === 0);
  const joined = await addReport(db, web("web-eeeeeee2", north(4020), "2026-10-10T03:00:00Z"), RULES.mergeM, { hold: true, cancel: "code-7" });
  check("a website report joining a live spot does not hold it", joined.spot.held === 0 && joined.spot.reports === 2);

  const soon = new Date(Date.now() + 60_000);
  check("the wrong undo code removes nothing", (await removeReport(db, "web-ddddddd1", { cancel: "nope" }, 600_000, soon)) === "not-found");
  check("an undo after the time allowed is refused", (await removeReport(db, "web-ddddddd1", { cancel: "code-6" }, 600_000, new Date(Date.now() + 3_600_000))) === "too-late");
  check("the right undo code removes the report", (await removeReport(db, "web-ddddddd1", { cancel: "code-6" }, 600_000, soon)) === "removed");
  check("a spot left with no reports is deleted", !(await allSpots(db)).some((s) => s.id === free.spot.id));
  check("a Karoo takes its own tap back with its install id", (await removeReport(db, "tap-eeeeeee1", { install: "install-1" }, 86_400_000, soon)) === "removed");
  const kept = (await allSpots(db)).find((s) => s.id === karoo.spot.id);
  check("the spot keeps its other report, with the count and dates put right", kept && kept.reports === 1 && kept.first_report === "2026-10-10T03:00:00.000Z");
  check("another Karoo's install id removes nothing", (await removeReport(db, "tap-bbbbbbb2", { install: "install-9" }, 86_400_000, soon)) === "not-found");
  check("the undo code is kept with the report", sqlite.prepare("SELECT cancel FROM reports WHERE uid = 'web-aaaaaaa1'").get().cancel === "code-1");
  check("the rule itself: only a Karoo tap or a later day confirms", confirmsHeld(one.spot, tap("x", HERE, "2026-10-10T02:00:00Z")) && !confirmsHeld(one.spot, web("y", HERE, "2026-10-10T09:00:00Z")));
}

console.log("limits and settings");
{
  const { db, sqlite } = freshDb();
  const now = new Date("2026-10-02T03:10:00Z");
  const goes = [];
  for (let i = 0; i < 4; i++) goes.push(await withinLimit(db, "r:someone", 3, now));
  check("the fourth go in an hour is refused", goes.join() === "true,true,true,false");
  check("another sender is not held back", await withinLimit(db, "r:someone-else", 3, now));
  check("the next hour starts again", await withinLimit(db, "r:someone", 3, new Date("2026-10-02T04:01:00Z")));
  await withinLimit(db, "r:someone", 3, new Date("2026-10-03T05:00:00Z"));
  const old = sqlite.prepare("SELECT COUNT(*) AS n FROM limits WHERE hour < '2026-10-03'").get().n;
  check("counts older than a day are deleted", old === 0, `${old} rows left`);

  check("defaults hold with nothing saved", (await readSettings(db)).merge_m === DEFAULTS.merge_m);
  await writeSetting(db, "merge_m", "200");
  await writeSetting(db, "merge_m", "220");
  const saved = await readSettings(db);
  check("a saved setting replaces the default", saved.merge_m === "220" && rulesFrom(saved).mergeM === 220);
  check("season months read as numbers", rulesFrom(saved).seasonMonths.join() === "8,9,10,11");
  check("a month 13 is refused", settingProblem("season_months", "8,13") !== null);
  check("a tip link must be https", settingProblem("tip_url", "http://example.com") !== null && settingProblem("tip_url", "https://ko-fi.com/someone") === null);
  check("an unknown setting is refused", settingProblem("nonsense", "1") !== null);
  check("holding website reports is on or off", settingProblem("hold_web_reports", "maybe") !== null && settingProblem("hold_web_reports", "off") === null);
  check("every default passes its own check", Object.entries(DEFAULTS).every(([k, v]) => settingProblem(k, v) === null));
}

console.log(failures ? `\n${failures} FAILED` : "\nall pass");
process.exit(failures ? 1 : 0);
