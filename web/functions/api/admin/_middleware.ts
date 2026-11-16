import { json, sameText, senderKey } from "../../../lib/http.ts";
import { withinLimit } from "../../../lib/store.ts";

// Every admin route needs the passphrase, sent as "Authorization: Bearer ...".
// It is held as the Cloudflare secret ADMIN_PASSPHRASE. Ten wrong tries from
// one sender in an hour locks that sender out until the hour turns.
const WRONG_TRIES = 10;

export async function onRequest(context: any): Promise<Response> {
  const { request, env } = context;
  if (!env.ADMIN_PASSPHRASE) return json({ error: "the admin passphrase is not set" }, 503);
  const now = new Date();
  const key = `a:${await senderKey(request, env, now)}`;
  const hour = now.toISOString().slice(0, 13);
  const wrong = await env.DB.prepare("SELECT n FROM limits WHERE key = ? AND hour = ?").bind(key, hour).first();
  if ((wrong?.n ?? 0) >= WRONG_TRIES) return json({ error: "too many wrong tries, wait an hour" }, 429);
  const given = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!(await sameText(given, env.ADMIN_PASSPHRASE))) {
    await withinLimit(env.DB, key, WRONG_TRIES, now);
    return json({ error: "wrong passphrase" }, 401);
  }
  return context.next();
}
