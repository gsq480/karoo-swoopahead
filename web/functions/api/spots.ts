import { json } from "../../lib/http.ts";
import { readSettings, rulesFrom, spotsNear } from "../../lib/store.ts";
import { forKaroo, inSeason, liveSpots } from "../../lib/swoop-core.ts";

// What a Karoo asks for: the live spots nearest it, and the values it would
// otherwise have to hard-code. The Karoo sends its position rounded to a tenth
// of a degree (about 10 km), which is all the sort needs.
const BOX_DEG = 3; // about 330 km each way

export async function onRequestGet({ request, env }: any): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const lat = Number(q.get("lat"));
  const lng = Number(q.get("lng"));
  const here = q.has("lat") && q.has("lng") && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
  const settings = await readSettings(env.DB);
  const rules = rulesFrom(settings);
  const now = new Date();
  const near = here ? await spotsNear(env.DB, here, BOX_DEG) : [];
  return json({
    on: inSeason(now, rules),
    sync_min: Number(settings.sync_min),
    months: rules.seasonMonths,
    spots: liveSpots(near, now, rules, here).map(forKaroo),
  });
}
