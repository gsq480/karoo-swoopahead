// Magpie swooping spots: the rules, with no imports, so tools/check.mjs can run
// them in bare node. store.ts binds them to the database.
//
// A spot is one bird's patch. A report (a tap on a Karoo, a pin on the website,
// a spot added by hand, an imported record) within mergeM of a spot joins it;
// anything further makes a spot. The service decides which spots are live, so
// the Karoo holds no rules of its own.

export type SwoopSource = "karoo" | "web" | "hand" | "datavic";
export type SwoopStatus = "active" | "quiet" | "removed";

export type SwoopSpot = {
  id: number;
  lat: number;
  lng: number;
  name: string | null;
  status: SwoopStatus;
  quiet_season: number | null;
  first_report: string;
  last_report: string;
  reports: number;
  held: number; // 1 while a website report waits to be confirmed
};

export type SwoopReport = {
  install: string | null; // a random id the sender made once; never sent back out
  lat: number;
  lng: number;
  headingDeg?: number | null;
  at: string; // ISO UTC
  source: SwoopSource;
  uid: string;
  name?: string | null;
  activity?: string | null;
};

export const ACTIVITIES = ["cycling", "walking", "running", "other"];

export type SwoopRules = {
  alerts: boolean;
  seasonMonths: number[]; // 1 to 12, local to the rider
  keepSeasons: number;
  mergeM: number;
};

export const MAX_SPOTS = 400; // about 28 KB of JSON, under the Karoo relay's 100 KB
export const TIME_ZONE = "Australia/Sydney";

// Reports must fall inside this box: the mainland, Tasmania and the near islands.
export const AUSTRALIA = { south: -44.5, north: -9.5, west: 112, east: 154.5 };

export function inAustralia(lat: number, lng: number): boolean {
  return lat >= AUSTRALIA.south && lat <= AUSTRALIA.north && lng >= AUSTRALIA.west && lng <= AUSTRALIA.east;
}

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// The local year and month of a moment, in the rider's time zone: the season
// is a local thing, and 1 August starts at local midnight.
export function localYearMonth(when: Date | string, timeZone = TIME_ZONE): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "numeric" }).formatToParts(
    typeof when === "string" ? new Date(when) : when,
  );
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month") };
}

export function inSeason(now: Date, rules: SwoopRules): boolean {
  return rules.alerts && rules.seasonMonths.includes(localYearMonth(now).month);
}

// Known means it belongs on the map: not removed, not marked quiet for this
// season, and reported within keepSeasons seasons (magpies come back to the
// same trees, so last year's spot still counts by default).
export function isKnown(spot: SwoopSpot, now: Date, rules: SwoopRules): boolean {
  if (spot.status === "removed") return false;
  const year = localYearMonth(now).year;
  if (spot.status === "quiet" && spot.quiet_season === year) return false;
  return year - localYearMonth(spot.last_report).year < rules.keepSeasons;
}

// Live means the Karoo warns for it: known, in season, and not held waiting
// to be confirmed.
export function isLive(spot: SwoopSpot, now: Date, rules: SwoopRules): boolean {
  return !spot.held && inSeason(now, rules) && isKnown(spot, now, rules);
}

// A spot made by a website report is held: it shows on the map as unconfirmed
// and warns nobody. It is confirmed by the admin, by a tap from a Karoo, or by
// a website report on a later day. A second website report on the same day does
// not count, because it is most likely the same person again.
export function confirmsHeld(spot: SwoopSpot, report: SwoopReport): boolean {
  if (report.source !== "web") return true;
  return localDay(report.at) > localDay(spot.last_report);
}

// Live spots nearest a position first, capped. With no position, the newest.
export function liveSpots(
  spots: SwoopSpot[], now: Date, rules: SwoopRules, at?: { lat: number; lng: number }, cap = MAX_SPOTS,
): SwoopSpot[] {
  const live = spots.filter((s) => isLive(s, now, rules));
  if (at) {
    const dist = new Map(live.map((s) => [s.id, haversineM(at.lat, at.lng, s.lat, s.lng)]));
    live.sort((a, b) => dist.get(a.id)! - dist.get(b.id)!);
  } else {
    live.sort((a, b) => b.last_report.localeCompare(a.last_report));
  }
  return live.slice(0, cap);
}

export function validReport(r: SwoopReport): boolean {
  return (
    Number.isFinite(r.lat) && Math.abs(r.lat) <= 90 &&
    Number.isFinite(r.lng) && Math.abs(r.lng) <= 180 &&
    typeof r.uid === "string" && r.uid.length >= 8 && r.uid.length <= 80 &&
    !Number.isNaN(Date.parse(r.at))
  );
}

// A report from a stranger must also be in Australia and recent: not from the
// future, and no older than a Karoo could have held it with no link.
export function plausibleReport(r: SwoopReport, now: Date, maxAgeDays = 60): boolean {
  if (!validReport(r) || !inAustralia(r.lat, r.lng)) return false;
  const age = now.getTime() - Date.parse(r.at);
  return age > -24 * 3_600_000 && age < maxAgeDays * 24 * 3_600_000;
}

// The local day of a moment, YYYY-MM-DD.
export function localDay(when: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(when));
}

// What the Karoo is sent: short keys, positions to a metre, dates to the day.
export function forKaroo(s: SwoopSpot): { id: number; lat: number; lng: number; name: string | null; last: string; n: number } {
  return {
    id: s.id,
    lat: Math.round(s.lat * 1e5) / 1e5,
    lng: Math.round(s.lng * 1e5) / 1e5,
    name: s.name,
    last: localDay(s.last_report),
    n: s.reports,
  };
}

// What the public map is sent: position to about 10 m, the day, the count,
// and 1 if the spot is still waiting to be confirmed.
export function forMap(s: SwoopSpot): [number, number, string, number, number] {
  return [Math.round(s.lat * 1e4) / 1e4, Math.round(s.lng * 1e4) / 1e4, localDay(s.last_report), s.reports, s.held ? 1 : 0];
}
