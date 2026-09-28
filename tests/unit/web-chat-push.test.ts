import { describe, expect, it, vi } from "vitest";
import { sourceExports } from "../helpers/source-handler";

const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const phone = "web:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const secret = "fixture-".repeat(8);

function handler(conversation: { id: string } | null = { id: "chat-1" }) {
  const calls: Array<[string, string, unknown]> = [];
  const send = vi.fn(async () => ({}));
  const rows: Record<string, unknown[]> = {
    admin_web_push_subscriptions: [
      { id: "sub-1", admin_user_id: "admin-1", endpoint: "https://fcm.googleapis.com/fcm/send/1", p256dh: "key", auth: "auth" },
      { id: "sub-2", admin_user_id: "admin-2", endpoint: "https://fcm.googleapis.com/fcm/send/2", p256dh: "key", auth: "auth" },
    ],
    admin_users: [
      { id: "admin-1", business_id: businessId, role: "ADMIN", suspended: false, read_only: false },
      { id: "admin-2", business_id: businessId, role: "ADMIN", suspended: true, read_only: false },
    ],
  };
  const db = {
    from(table: string) {
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { calls.push([table, column, value]); return query; },
        in() { return query; },
        async maybeSingle() { return { data: conversation, error: null }; },
        then(resolve: (value: unknown) => void) { resolve({ data: rows[table], error: null }); },
      };
      return query;
    },
  };
  const { POST } = sourceExports("app/api/internal/web-chat-push/route.ts", {
    "@supabase/supabase-js": { createClient: () => db },
    "node:crypto": { timingSafeEqual: (left: Buffer, right: Buffer) => left.equals(right) },
    "web-push": { default: { setVapidDetails: () => {}, sendNotification: send } },
  }, { WEB_PUSH_PUBLIC_KEY: "public", WEB_PUSH_PRIVATE_KEY: "private", ADMIN_PUSH_SECRET: secret }) as { POST: (request: Request) => Promise<Response> };
  return { POST, calls, send };
}

function request(token = secret) {
  return new Request("https://fixture.invalid/api/internal/web-chat-push", {
    method: "POST", headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ business_id: businessId, phone }),
  });
}

describe("web chat phone push", () => {
  it("rejects callers without the internal secret before reading tenant data", async () => {
    const { POST, calls, send } = handler();
    expect((await POST(request("wrong"))).status).toBe(401);
    expect(calls).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("alerts active staff only for a live human conversation in the requested business", async () => {
    const inactive = handler(null);
    expect(await (await inactive.POST(request())).json()).toEqual({ sent: 0 });
    expect(inactive.send).not.toHaveBeenCalled();

    const active = handler();
    expect(await (await active.POST(request())).json()).toEqual({ sent: 1 });
    expect(active.calls).toContainEqual(["conversations", "business_id", businessId]);
    expect(active.calls).toContainEqual(["conversations", "phone", phone]);
    expect(active.calls).toContainEqual(["conversations", "status", "HUMAN"]);
    expect(active.calls).toContainEqual(["admin_web_push_subscriptions", "business_id", businessId]);
    expect(active.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(active.send.mock.calls[0][1] as string);
    expect(payload.url).toBe("/inbox?phone=" + encodeURIComponent(phone));
    expect(payload).not.toHaveProperty("message");
  });

  it("binds a device subscription to the authenticated operator and rejects other destinations", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const { POST } = sourceExports("app/api/admin/web-push/route.ts", {
      "@/app/lib/api-auth": { getCallerAdmin: async () => ({ id: "admin-1", business_id: businessId }) },
      "@supabase/supabase-js": { createClient: () => ({ from: () => ({ upsert }) }) },
    }) as { POST: (request: Request) => Promise<Response> };
    const body = { endpoint: "https://fcm.googleapis.com/fcm/send/device-1", keys: { p256dh: "key", auth: "auth" }, business_id: "other" };
    const post = (subscription: object) => POST(new Request("https://fixture.invalid/api/admin/web-push", {
      method: "POST", body: JSON.stringify(subscription),
    }));
    expect((await post({ ...body, endpoint: "https://attacker.invalid/push" })).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
    expect((await post(body)).status).toBe(200);
    expect(upsert).toHaveBeenCalledWith({
      business_id: businessId, admin_user_id: "admin-1", endpoint: body.endpoint,
      p256dh: "key", auth: "auth",
    }, { onConflict: "endpoint" });
  });
});
