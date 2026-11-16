import { json, senderKey } from "../../../lib/http.ts";
import { removeReport, withinLimit } from "../../../lib/store.ts";

// Take a report back. The website sends the undo code it was given, and has
// ten minutes. A Karoo sends its own install id, and has a day.
const WEB_MS = 10 * 60_000;
const KAROO_MS = 24 * 3_600_000;

export async function onRequestPost({ request, env }: any): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "not JSON" }, 400);
  }
  const uid = String(body?.uid ?? "");
  const cancel = typeof body?.cancel === "string" ? body.cancel : "";
  const install = typeof body?.install === "string" ? body.install : "";
  if (uid.length < 8 || (!cancel && !install)) return json({ error: "nothing to cancel" }, 400);
  const now = new Date();
  if (!(await withinLimit(env.DB, `c:${await senderKey(request, env, now)}`, 30, now))) return json({ error: "too many tries this hour" }, 429);
  const result = await removeReport(env.DB, uid, cancel ? { cancel } : { install }, cancel ? WEB_MS : KAROO_MS, now);
  // A Karoo keeps asking until it hears yes, so a report already gone is a yes too.
  if (result === "too-late") return json({ error: "too late to cancel" }, 410);
  return json({ ok: true, removed: result === "removed" });
}
