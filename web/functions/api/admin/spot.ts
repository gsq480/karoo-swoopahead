import { json } from "../../../lib/http.ts";
import { addReport, approveSpot, quietSpot, readSettings, removeSpot, renameSpot, rulesFrom, spotById, wakeSpot } from "../../../lib/store.ts";
import { inAustralia } from "../../../lib/swoop-core.ts";

// Change one spot, or add one by hand.
export async function onRequestPost({ request, env }: any): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "not JSON" }, 400);
  }
  const action = String(body?.action ?? "");
  if (action === "add") {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inAustralia(lat, lng)) return json({ error: "not a place in Australia" }, 400);
    const mergeM = rulesFrom(await readSettings(env.DB)).mergeM;
    const { spot, created } = await addReport(env.DB, {
      install: null, lat, lng, at: new Date().toISOString(), source: "hand",
      uid: `hand-${crypto.randomUUID()}`, name: typeof body.name === "string" ? body.name : null,
    }, mergeM);
    return json({ ok: true, spot: spot.id, created });
  }
  const id = Number(body?.id);
  if (!Number.isInteger(id) || !(await spotById(env.DB, id))) return json({ error: "no such spot" }, 404);
  if (action === "quiet") await quietSpot(env.DB, id, new Date());
  else if (action === "wake") await wakeSpot(env.DB, id);
  else if (action === "approve") await approveSpot(env.DB, id);
  else if (action === "remove") await removeSpot(env.DB, id);
  else if (action === "rename") await renameSpot(env.DB, id, String(body.name ?? ""));
  else return json({ error: "no such action" }, 400);
  return json({ ok: true, spot: id });
}
