import { humanCheckPassed, json, senderKey } from "../../../lib/http.ts";
import { addReport, readSettings, rulesFrom, withinLimit } from "../../../lib/store.ts";
import { ACTIVITIES, plausibleReport, type SwoopReport } from "../../../lib/swoop-core.ts";

// A swoop, from a tap on a Karoo or a pin on the website. No sign-in: what
// keeps it honest is a limit on reports per hour from one sender, the rule
// that a report must be recent and in Australia, the website's human check,
// and the admin page, where any spot can be removed.
export async function onRequestPost({ request, env }: any): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "not JSON" }, 400);
  }
  const web = body?.source === "web";
  const report: SwoopReport = {
    install: typeof body?.install === "string" ? body.install.slice(0, 64) : null,
    lat: Number(body?.lat),
    lng: Number(body?.lng),
    headingDeg: typeof body?.heading === "number" && Number.isFinite(body.heading) ? body.heading : null,
    at: String(body?.at ?? ""),
    source: web ? "web" : "karoo",
    uid: String(body?.uid ?? ""),
    activity: ACTIVITIES.includes(body?.activity) ? body.activity : null,
  };
  const now = new Date();
  if (!plausibleReport(report, now)) return json({ error: "not a recent report in Australia" }, 400);
  // The website's form asks the reporter to say it really happened, and what they were doing.
  if (web && (body?.confirmed !== true || !report.activity)) return json({ error: "the form is not complete" }, 400);

  const settings = await readSettings(env.DB);
  const sender = await senderKey(request, env, now);
  if (!(await withinLimit(env.DB, `r:${sender}`, Number(settings.reports_per_hour), now))) {
    return json({ error: "too many reports this hour" }, 429);
  }
  if (web && env.TURNSTILE_SECRET && !(await humanCheckPassed(String(body?.human ?? ""), env.TURNSTILE_SECRET, request))) {
    return json({ error: "the human check did not pass" }, 403);
  }
  // A website report gets an undo code, and a spot it makes is held until confirmed.
  const cancel = web ? crypto.randomUUID() : null;
  const { spot, created, repeat } = await addReport(env.DB, report, rulesFrom(settings).mergeM, {
    hold: web && settings.hold_web_reports === "on", cancel,
  });
  return json({ ok: true, spot: spot.id, created, repeat, held: !!spot.held, ...(web && !repeat ? { cancel } : {}) });
}
