// The rules in swoop-core.ts, bound to the database. Written against the small
// part of Cloudflare D1 they use, so tools/check.mjs can hand in a stand-in.

import {
  confirmsHeld, haversineM, localYearMonth,
  type SwoopReport, type SwoopRules, type SwoopSpot,
} from "./swoop-core.ts";

type Stmt = {
  bind(...args: unknown[]): Stmt;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { last_row_id: number; changes: number } }>;
};
export type Db = { prepare(sql: string): Stmt };

const SPOT_COLS = "id, lat, lng, name, status, quiet_season, first_report, last_report, reports, held";

// What a setting is when nobody has changed it. Every key here shows on the
// admin page; a key not here is refused.
export const DEFAULTS: Record<string, string> = {
  alerts: "on",
  season_months: "8,9,10,11",
  keep_seasons: "2",
  merge_m: "150",
  sync_min: "30",
  reports_per_hour: "12",
  hold_web_reports: "on",
  tip_url: "",
};

export async function readSettings(db: Db): Promise<Record<string, string>> {
  const rows = (await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>()).results;
  const out = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) out[r.key] = r.value;
  return out;
}

// Null when the value is fine, otherwise what is wrong with it.
export function settingProblem(key: string, value: string): string | null {
  const whole = (min: number, max: number) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= min && n <= max ? null : `a whole number from ${min} to ${max}`;
  };
  switch (key) {
    case "alerts":
    case "hold_web_reports": return value === "on" || value === "off" ? null : "on or off";
    case "season_months": {
      const months = value.split(",").map((m) => Number(m.trim()));
      return months.length > 0 && months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)
        ? null : "month numbers from 1 to 12, with commas between";
    }
    case "keep_seasons": return whole(1, 10);
    case "merge_m": return whole(20, 1000);
    case "sync_min": return whole(5, 240);
    case "reports_per_hour": return whole(1, 500);
    case "tip_url": return value === "" || /^https:\/\/[^\s]{4,200}$/.test(value) ? null : "empty, or an address starting https://";
    default: return "not a setting";
  }
}

export async function writeSetting(db: Db, key: string, value: string): Promise<void> {
  await db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value).run();
}

export function rulesFrom(s: Record<string, string>): SwoopRules {
  return {
    alerts: s.alerts === "on",
    seasonMonths: s.season_months.split(",").map((m) => Number(m.trim())).filter((m) => m >= 1 && m <= 12),
    keepSeasons: Number(s.keep_seasons),
    mergeM: Number(s.merge_m),
  };
}

export async function allSpots(db: Db): Promise<SwoopSpot[]> {
  return (await db.prepare(`SELECT ${SPOT_COLS} FROM spots`).all<SwoopSpot>()).results;
}

// Spots that aren't removed inside a box around a position. The Karoo only
// needs the ones near it, and the box keeps the read small.
export async function spotsNear(db: Db, at: { lat: number; lng: number }, boxDeg: number): Promise<SwoopSpot[]> {
  return (await db.prepare(
    `SELECT ${SPOT_COLS} FROM spots WHERE status != 'removed' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
  ).bind(at.lat - boxDeg, at.lat + boxDeg, at.lng - boxDeg, at.lng + boxDeg).all<SwoopSpot>()).results;
}

export async function spotById(db: Db, id: number): Promise<SwoopSpot | null> {
  return db.prepare(`SELECT ${SPOT_COLS} FROM spots WHERE id = ?`).bind(id).first<SwoopSpot>();
}

// Store one report and return its spot. A uid seen before changes nothing, so
// a Karoo can resend a tap until it hears back. A removed or quiet spot that
// gets a fresh report is active again: someone was just swooped there.
//
// hold: a new spot made by this report waits to be confirmed. cancel: an undo
// code kept with the report.
export async function addReport(
  db: Db, r: SwoopReport, mergeM: number, opts: { hold?: boolean; cancel?: string | null } = {},
): Promise<{ spot: SwoopSpot; created: boolean; repeat: boolean }> {
  const seen = await db.prepare("SELECT spot_id FROM reports WHERE uid = ?").bind(r.uid).first<{ spot_id: number }>();
  if (seen) return { spot: (await spotById(db, seen.spot_id))!, created: false, repeat: true };

  const at = new Date(r.at).toISOString();
  const box = (mergeM / 111_000) * 1.6; // wide enough for the longitude squeeze at Australia's latitudes
  let nearest: SwoopSpot | undefined;
  let nearestM = Infinity;
  const close = (await db.prepare(
    `SELECT ${SPOT_COLS} FROM spots WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
  ).bind(r.lat - box, r.lat + box, r.lng - box, r.lng + box).all<SwoopSpot>()).results;
  for (const s of close) {
    const m = haversineM(r.lat, r.lng, s.lat, s.lng);
    if (m <= mergeM && m < nearestM) { nearest = s; nearestM = m; }
  }

  const name = r.name?.trim().slice(0, 60) || null;
  let spotId: number;
  if (nearest) {
    spotId = nearest.id;
    const held = nearest.held && !confirmsHeld(nearest, r) ? 1 : 0;
    await db.prepare(
      `UPDATE spots SET status = 'active', quiet_season = NULL, reports = reports + 1,
         first_report = MIN(first_report, ?), last_report = MAX(last_report, ?),
         name = COALESCE(name, ?), held = ?
       WHERE id = ?`,
    ).bind(at, at, name, held, spotId).run();
  } else {
    spotId = Number((await db.prepare(
      "INSERT INTO spots (lat, lng, name, first_report, last_report, held) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(r.lat, r.lng, name, at, at, opts.hold ? 1 : 0).run()).meta.last_row_id);
  }
  await db.prepare(
    `INSERT INTO reports (spot_id, install, lat, lng, heading_deg, at, source, uid, activity, cancel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(spotId, r.install, r.lat, r.lng, r.headingDeg ?? null, at, r.source, r.uid, r.activity ?? null, opts.cancel ?? null).run();
  return { spot: (await spotById(db, spotId))!, created: !nearest, repeat: false };
}

// Take one report back. The sender proves it is theirs with the undo code the
// website was given, or with the Karoo's own install id, and only within the
// time allowed. The spot loses the report; a spot left with none is deleted.
export async function removeReport(
  db: Db, uid: string, proof: { cancel?: string; install?: string }, maxAgeMs: number, now: Date,
): Promise<"removed" | "not-found" | "too-late"> {
  const row = await db.prepare("SELECT id, spot_id, install, cancel, created_at FROM reports WHERE uid = ?").bind(uid)
    .first<{ id: number; spot_id: number; install: string | null; cancel: string | null; created_at: string }>();
  if (!row) return "not-found";
  const mine = (proof.cancel && row.cancel && proof.cancel === row.cancel) || (proof.install && row.install && proof.install === row.install);
  if (!mine) return "not-found";
  if (now.getTime() - Date.parse(row.created_at) > maxAgeMs) return "too-late";
  await db.prepare("DELETE FROM reports WHERE id = ?").bind(row.id).run();
  const left = await db.prepare("SELECT COUNT(*) AS n, MIN(at) AS first, MAX(at) AS last FROM reports WHERE spot_id = ?").bind(row.spot_id)
    .first<{ n: number; first: string | null; last: string | null }>();
  if (!left || left.n === 0) await db.prepare("DELETE FROM spots WHERE id = ?").bind(row.spot_id).run();
  else await db.prepare("UPDATE spots SET reports = ?, first_report = ?, last_report = ? WHERE id = ?").bind(left.n, left.first, left.last, row.spot_id).run();
  return "removed";
}

// The admin says a held spot is real.
export async function approveSpot(db: Db, id: number): Promise<void> {
  await db.prepare("UPDATE spots SET held = 0 WHERE id = ?").bind(id).run();
}

export async function quietSpot(db: Db, id: number, now: Date): Promise<void> {
  await db.prepare("UPDATE spots SET status = 'quiet', quiet_season = ? WHERE id = ? AND status != 'removed'")
    .bind(localYearMonth(now).year, id).run();
}

export async function wakeSpot(db: Db, id: number): Promise<void> {
  await db.prepare("UPDATE spots SET status = 'active', quiet_season = NULL WHERE id = ?").bind(id).run();
}

export async function removeSpot(db: Db, id: number): Promise<void> {
  await db.prepare("UPDATE spots SET status = 'removed', quiet_season = NULL WHERE id = ?").bind(id).run();
}

export async function renameSpot(db: Db, id: number, name: string): Promise<void> {
  await db.prepare("UPDATE spots SET name = ? WHERE id = ?").bind(name.trim().slice(0, 60) || null, id).run();
}

// Count one more go for a key in this hour, and say whether it is still within
// the limit. Rows from earlier days are cleared as it goes, so nothing about a
// sender outlives the day.
export async function withinLimit(db: Db, key: string, limit: number, now: Date): Promise<boolean> {
  const hour = now.toISOString().slice(0, 13);
  await db.prepare("DELETE FROM limits WHERE hour < ?").bind(new Date(now.getTime() - 24 * 3_600_000).toISOString().slice(0, 13)).run();
  await db.prepare("INSERT INTO limits (key, hour, n) VALUES (?, ?, 1) ON CONFLICT(key, hour) DO UPDATE SET n = n + 1")
    .bind(key, hour).run();
  const row = await db.prepare("SELECT n FROM limits WHERE key = ? AND hour = ?").bind(key, hour).first<{ n: number }>();
  return (row?.n ?? 1) <= limit;
}
