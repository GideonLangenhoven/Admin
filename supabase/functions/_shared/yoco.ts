// Yoco REST helpers shared by the onboarding wizard.
//
// Contract verified against developer.yoco.com (2026-08-15):
//   POST https://payments.yoco.com/api/webhooks
//     Authorization: Bearer <secret key>
//     { name, url }  ->  201 { id, mode, name, secret, url }
//   GET    /api/webhooks          -> [ { id, name, url, mode } ]
//   DELETE /api/webhooks/{id}     -> 204
//
// The signing secret is returned ONCE at registration and never again. Anything
// that registers a webhook must persist the secret in the same breath, and a
// webhook whose secret we lost is worthless — hence the delete-then-register
// path below rather than reusing an existing subscription.

const YOCO_API = "https://payments.yoco.com/api";

// Flat rather than a discriminated union: these functions are consumed from
// Deno modules compiled with `strict: false` (supabase/functions/deno.json),
// where narrowing on an `ok: true | false` discriminant is unreliable.
// Callers branch on `.ok` and read the fields that belong to that branch.
export type YocoWebhookResult = {
  ok: boolean;
  id?: string;
  secret?: string;
  mode?: string;
  error?: string;
};

// Yoco answers 401 *and* 403 for a bad key (403 reproduced live with a rejected
// live key), so both mean invalid. Every other status — including a 400 for the
// deliberately incomplete body — means the key authenticated fine.
export async function validateYocoKey(secretKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${YOCO_API}/checkouts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: 100, currency: "ZAR" }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Invalid Yoco secret key. Check the key and try again." };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach Yoco to validate the key: ${err instanceof Error ? err.message : "network error"}`,
    };
  }
}

async function yocoJson(secretKey: string, path: string, init?: RequestInit) {
  const res = await fetch(`${YOCO_API}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  return { status: res.status, ok: res.ok, body, text };
}

// Registers `url` as a webhook on the merchant's account and returns the signing
// secret. Any pre-existing webhook on the same URL is deleted first: its secret
// is unrecoverable, so leaving it in place would mean Yoco signing deliveries
// with a key we cannot verify against.
export async function registerYocoWebhook(
  secretKey: string,
  url: string,
  name = "bookingtours",
): Promise<YocoWebhookResult> {
  try {
    const existing = await yocoJson(secretKey, "/webhooks", { method: "GET" });
    if (existing.ok) {
      const list: any[] = Array.isArray(existing.body)
        ? existing.body
        : (existing.body?.subscriptions || existing.body?.data || []);
      for (const hook of list) {
        if (hook?.id && String(hook.url || "") === url) {
          await yocoJson(secretKey, `/webhooks/${hook.id}`, { method: "DELETE" });
        }
      }
    }

    const created = await yocoJson(secretKey, "/webhooks", {
      method: "POST",
      body: JSON.stringify({ name, url }),
    });

    if (!created.ok) {
      return {
        ok: false,
        error: `Yoco rejected the webhook registration (HTTP ${created.status}): ${created.body?.message || created.text || "no detail"}`,
      };
    }

    const secret = String(created.body?.secret || "");
    const id = String(created.body?.id || "");
    if (!secret) {
      // Registered but secret-less: we can never verify its deliveries, and the
      // secret is not re-issuable. Roll it back so a retry starts clean.
      if (id) await yocoJson(secretKey, `/webhooks/${id}`, { method: "DELETE" });
      return { ok: false, error: "Yoco registered the webhook but returned no signing secret." };
    }

    return { ok: true, id, secret, mode: String(created.body?.mode || "") };
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach Yoco to register the webhook: ${err instanceof Error ? err.message : "network error"}`,
    };
  }
}
