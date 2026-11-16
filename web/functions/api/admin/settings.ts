import { json } from "../../../lib/http.ts";
import { readSettings, settingProblem, writeSetting } from "../../../lib/store.ts";

// Change settings. The body is the keys to change and their new values. If
// any value is wrong, nothing is saved and the answer says what each needs.
export async function onRequestPost({ request, env }: any): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "not JSON" }, 400);
  }
  const changes = Object.entries(body ?? {}).map(([key, value]) => [key, String(value).trim()] as const);
  const problems: Record<string, string> = {};
  for (const [key, value] of changes) {
    const problem = settingProblem(key, value);
    if (problem) problems[key] = problem;
  }
  if (Object.keys(problems).length > 0) return json({ error: "some values are wrong", problems }, 400);
  for (const [key, value] of changes) await writeSetting(env.DB, key, value);
  return json({ ok: true, settings: await readSettings(env.DB) });
}
