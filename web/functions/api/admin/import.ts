import { json } from "../../../lib/http.ts";
import { addReport, readSettings, rulesFrom } from "../../../lib/store.ts";
import { inAustralia, validReport, type SwoopReport } from "../../../lib/swoop-core.ts";

// Bring in open data a few records at a time (tools/import-vic.py sends them).
// Each record goes through the same door as a rider's tap, so it joins a spot
// by the same rule, and a record sent twice counts once.
const MAX_AT_ONCE = 8;

export async function onRequestPost({ request, env }: any): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "not JSON" }, 400);
  }
  const records = Array.isArray(body?.reports) ? body.reports : [];
  if (records.length === 0 || records.length > MAX_AT_ONCE) return json({ error: `send 1 to ${MAX_AT_ONCE} reports` }, 400);
  const mergeM = rulesFrom(await readSettings(env.DB)).mergeM;
  let added = 0, repeats = 0, refused = 0, spots = 0;
  for (const r of records) {
    const report: SwoopReport = {
      install: null, lat: Number(r?.lat), lng: Number(r?.lng), at: String(r?.at ?? ""),
      source: "datavic", uid: String(r?.uid ?? ""), name: typeof r?.name === "string" ? r.name : null,
    };
    if (!validReport(report) || !inAustralia(report.lat, report.lng)) { refused++; continue; }
    const result = await addReport(env.DB, report, mergeM);
    if (result.repeat) repeats++; else added++;
    if (result.created) spots++;
  }
  return json({ ok: true, added, repeats, refused, new_spots: spots });
}
