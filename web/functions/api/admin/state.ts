import { json } from "../../../lib/http.ts";
import { DEFAULTS, allSpots, readSettings, rulesFrom } from "../../../lib/store.ts";
import { inSeason, isKnown, isLive } from "../../../lib/swoop-core.ts";

// Everything the admin page shows: every spot (removed ones too, so one can be
// brought back), the newest reports, and the settings.
export async function onRequestGet({ env }: any): Promise<Response> {
  const settings = await readSettings(env.DB);
  const rules = rulesFrom(settings);
  const now = new Date();
  const spots = (await allSpots(env.DB))
    .sort((a, b) => b.last_report.localeCompare(a.last_report))
    .map((s) => ({ ...s, known: isKnown(s, now, rules), live: isLive(s, now, rules) }));
  const reports = (await env.DB.prepare(
    `SELECT id, spot_id, lat, lng, at, source, activity, substr(install, 1, 6) AS install, created_at
       FROM reports ORDER BY created_at DESC, id DESC LIMIT 200`,
  ).all()).results;
  return json({ season: inSeason(now, rules), settings, defaults: DEFAULTS, spots, reports });
}
