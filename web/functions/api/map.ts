import { json } from "../../lib/http.ts";
import { allSpots, readSettings, rulesFrom } from "../../lib/store.ts";
import { forMap, inSeason, isKnown } from "../../lib/swoop-core.ts";

// Everything the website's map needs. Spots are shown all year, whether or not
// it is the season: position to about 10 m, the day of the last report and the
// number of reports. Nothing about who reported.
export async function onRequestGet({ env }: any): Promise<Response> {
  const settings = await readSettings(env.DB);
  const rules = rulesFrom(settings);
  const now = new Date();
  const spots = (await allSpots(env.DB)).filter((s) => isKnown(s, now, rules));
  return json({
    season: inSeason(now, rules),
    months: rules.seasonMonths,
    tip_url: settings.tip_url || null,
    human_check_key: env.TURNSTILE_SITE_KEY ?? null,
    spots: spots.map(forMap),
  }, 200, { "Cache-Control": "public, max-age=120" });
}
