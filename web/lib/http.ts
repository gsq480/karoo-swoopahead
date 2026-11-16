// Small helpers the routes share.

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// A stand-in for the sender's network address, used only to count goes per
// hour. It is scrambled with a secret and the date, so it can't be turned back
// into an address and is a different value every day.
export async function senderKey(request: Request, env: any, now: Date): Promise<string> {
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const salt = env.LIMIT_SALT ?? env.ADMIN_PASSPHRASE ?? "swoopahead";
  return (await sha256Hex(`${address}|${now.toISOString().slice(0, 10)}|${salt}`)).slice(0, 32);
}

// True when two texts match, taking the same time whether or not they do.
export async function sameText(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// Ask Cloudflare whether the website's human check passed.
export async function humanCheckPassed(token: string, secret: string, request: Request): Promise<boolean> {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  const address = request.headers.get("CF-Connecting-IP");
  if (address) form.append("remoteip", address);
  try {
    const answer = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    return ((await answer.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}
